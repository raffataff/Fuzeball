import bpy, math
from mathutils import Vector
from pathlib import Path
root=Path(r'C:\Users\Owner\Documents\Fuzeball\Fuzeball')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'output/alien-concepts/full.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
def material(name,filename):
 m=bpy.data.materials.new(name); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Metallic'].default_value=.15; p.inputs['Roughness'].default_value=.66
 t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=bpy.data.images.load(str(root/'output/alien-concepts'/filename)); m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color']); return m
wall=material('alien_refined_shell','wall-bright.png'); leg=material('alien_refined_leg','leg-bright.png')
for o in meshes:
 if not (o.name.startswith('wall_side') or o.name.startswith('wall_end') or o.name.startswith('table_base') or o.name.startswith('table_leg')): continue
 isleg=o.name.startswith('table_leg'); o.data.materials.clear(); o.data.materials.append(leg if isleg else wall)
 uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
 vs=[o.matrix_world @ v.co for v in o.data.vertices]; xmin=min(v.x for v in vs); xmax=max(v.x for v in vs); ymin=min(v.y for v in vs); ymax=max(v.y for v in vs)
 for poly in o.data.polygons:
  n=o.matrix_world.to_3x3() @ poly.normal
  for li in poly.loop_indices:
   p=vs[o.data.loops[li].vertex_index]
   if isleg:
    u=(p.y-ymin)/max(.01,ymax-ymin) if abs(n.x)>abs(n.y) else (p.x-xmin)/max(.01,xmax-xmin); v=(p.z+43.98)/35.24
   else:
    u=(p.y+37)/74 if abs(n.x)>abs(n.y) else (p.x+63.05)/126.1; v=(p.z+9.12)/20.12
   uv.data[li].uv=(u,v)

# Enlarge leg cladding around the existing leg centres, without moving its ends.
for o in meshes:
 if o.name.startswith('table_leg'):
  vs=[v.co for v in o.data.vertices]; cx=(min(v.x for v in vs)+max(v.x for v in vs))/2; cy=(min(v.y for v in vs)+max(v.y for v in vs))/2
  for v in vs: v.x=cx+(v.x-cx)*1.38; v.y=cy+(v.y-cy)*1.38

def solid(name,color,metal=.4,emission=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=.58
 if emission: p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
 return m
armor=solid('alien_corner_armour',(.105,.115,.095)); edge=solid('alien_corner_edges',(.21,.23,.17)); glow=solid('alien_inlay',(.21,.33,.055),.15,.22)
def box(name,loc,scale,mat,bevel=.0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.name=name; o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('soft machined edges','BEVEL'); mod.width=bevel; mod.segments=2; bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
 o.data.materials.append(mat); meshes.append(o); return o

# Replace the rounded goal tubes with an angular frame, retaining each game object name.
for sx in (-1,1):
 goal=next(o for o in meshes if o.name.startswith('goal_frame_l' if sx<0 else 'goal_frame_r'))
 goal.data.clear_geometry(); goal.data.materials.clear()
 x=sx*59.95; bits=[]
 for sy in (-1,1):
  bits.append(box('goal_armour',(x,sy*11.0,4.95),(1.05,1.05,10.1),armor,.12))
  for front in (sx*59.40,sx*60.50):
   bits.append(box('goal_inlay',(front,sy*10.72,4.8),(.09,.10,9.15),glow,.02))
   bits.append(box('goal_edge',(front,sy*11.32,4.95),(.09,.11,9.55),edge,.02))
 bits.append(box('goal_armour',(x,0,10.05),(1.05,22.95,1.0),armor,.12))
 for front in (sx*59.40,sx*60.50):
  bits.append(box('goal_inlay',(front,0,9.74),(.09,21.55,.10),glow,.02))
  bits.append(box('goal_edge',(front,0,10.36),(.09,22.25,.10),edge,.02))
 bpy.ops.object.select_all(action='DESELECT'); goal.select_set(True)
 for b in bits: b.select_set(True)
 bpy.context.view_layer.objects.active=goal; bpy.ops.object.join()
 meshes=[o for o in meshes if o not in bits]

# Corner armour sits outside the playing area and stops short of the rod holes.
for sx in (-1,1):
 for sy in (-1,1):
  x=sx*60.55; y=sy*35.65
  box('alien_corner_post',(x,y,1.0),(4.9,3.05,19.7),armor,.45)
  for z in (-7.8,-1.0,5.6,10.4):
   box('alien_corner_band',(x,y,z),(5.08,3.22,.48),edge,.13)
  for z in (-7.35,5.95):
   box('alien_corner_inlay',(x,y+sy*1.63,z),(3.85,.08,.10),glow)
  # A cuff and foot make the existing narrow supports feel like armored legs.
  lx=sx*58; ly=sy*32
  for z,h in [(-10.4,2.0),(-42.7,2.4)]:
   box('alien_leg_cuff',(lx,ly,z),(6.3,6.3,h),armor,.22)
   box('alien_leg_cuff_trim',(lx,ly,z-h*.30),(6.42,6.42,.14),edge,.03)
  for dx in (-2.1,2.1):
   box('alien_leg_inlay',(lx+dx,ly+sy*2.81,-26.6),(.10,.10,26.5),glow)
# Long thin rails give the layered shell an unbroken architectural edge.
for sy in (-1,1):
 for z,h,mat in [(-7.45,.18,glow),(-8.25,.32,edge),(-.86,.25,edge)]:
  box('alien_side_rail',(0,sy*37.05,z),(115,.12,h),mat,.03)
for sx in (-1,1):
 for z,h,mat in [(-7.45,.18,glow),(-8.25,.32,edge)]:
  box('alien_end_rail',(sx*63.08,0,z),(.12,67,h),mat,.03)


# Engraved top-rail decals sit alongside the functional light strips.
rail=material('alien_engraved_top','rail-decal.png')
def top_decal(name,coords,repeat):
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(coords,[],[(0,1,2,3)]); mesh.update(); o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); mesh.materials.append(rail)
 uv=mesh.uv_layers.new(name='UVMap'); uvs=[(0,0),(repeat,0),(repeat,1),(0,1)]
 for i,coord in enumerate(uvs): uv.data[i].uv=coord
 meshes.append(o)
for sy in (-1,1):
 y0,y1=sorted((sy*35.95,sy*36.95))
 top_decal('alien_top_side',[(-58.6,y0,11.035),(58.6,y0,11.035),(58.6,y1,11.035),(-58.6,y1,11.035)],5.86)
for sx in (-1,1):
 x0,x1=sorted((sx*60.12,sx*62.88))
 for sy in (-1,1):
  y0,y1=sorted((sy*11.1,sy*33.85))
  top_decal('alien_top_end',[(x1,y0,11.035),(x1,y1,11.035),(x0,y1,11.035),(x0,y0,11.035)],1.14)

# Batch decorative geometry by material to keep draw calls low.
for mat in (armor,edge,glow,rail):
 group=[o for o in meshes if o.name.startswith('alien_') and len(o.data.materials) and o.data.materials[0]==mat]
 if len(group)>1:
  bpy.ops.object.select_all(action='DESELECT')
  for o in group: o.select_set(True)
  bpy.context.view_layer.objects.active=group[0]; bpy.ops.object.join()
  meshes=[o for o in meshes if o not in group[1:]]
  group[0].name='alien_decor_'+mat.name
# Export game objects only.
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.export_scene.gltf(filepath=str(root/'output/alien-concepts/candidate.glb'),export_format='GLB',use_selection=True)
# preview

# Display the separate pitch and hide the placeholder nets in the preview.
pitch=bpy.data.materials.new('preview_pitch'); pitch.use_nodes=True
node=pitch.node_tree.nodes.new('ShaderNodeTexImage'); node.image=bpy.data.images.load(str(root/'assets/pitches/alien_tech.jpeg'))
pitch.node_tree.links.new(node.outputs['Color'],pitch.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
for o in meshes:
 if o.name.startswith('goal_net'): o.hide_render=True
 if o.name.startswith('field'):
  o.data.materials.clear(); o.data.materials.append(pitch); uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
  for poly in o.data.polygons:
   for li in poly.loop_indices:
    p=o.matrix_world @ o.data.vertices[o.data.loops[li].vertex_index].co; uv.data[li].uv=((p.x+60)/120,(p.y+34)/68)

bpy.ops.object.select_all(action='DESELECT')
world=bpy.data.worlds.new('Preview'); bpy.context.scene.world=world; world.color=(.22,.22,.22)
def point(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(185,-220,150)); cam=bpy.context.object; point(cam,(0,0,-10)); cam.data.type='ORTHO'; cam.data.ortho_scale=220; bpy.context.scene.camera=cam
for loc,power,size in [((30,-100,180),220000,110),((-150,-30,70),120000,90),((30,130,130),180000,100)]:
 bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; l.data.energy=power; l.data.shape='DISK'; l.data.size=size; point(l,(0,0,-5))
s=bpy.context.scene; s.render.engine='CYCLES'; s.cycles.samples=24; s.render.resolution_x=1200; s.render.resolution_y=800; s.render.resolution_percentage=100; s.render.image_settings.file_format='PNG'; s.render.filepath=str(root/'output/alien-concepts/preview.png'); s.world.color=(.12,.12,.12); bpy.ops.render.render(write_still=True)




cam.location=(115,-85,48); point(cam,(60,0,4)); cam.data.ortho_scale=62; s.render.resolution_x=1200; s.render.resolution_y=800; s.render.filepath=str(root/'output/alien-concepts/goal-close.png'); bpy.ops.render.render(write_still=True)

