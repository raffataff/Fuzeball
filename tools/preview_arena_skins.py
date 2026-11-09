"""Material-only arena proposals. Run with Blender --background --python this_file."""
import bpy, os, json, struct, hashlib, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'output', 'arena-skins-2026-11-08')
os.makedirs(OUT, exist_ok=True)
SOURCE = os.path.join(ROOT, 'assets', 'tables', 'arena', 'fuzeball_table_arena_standard.glb')
# Strip compressed textures only, leaving the source geometry binary byte-identical.
raw = open(SOURCE, 'rb').read()
jsize = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+jsize])
def remove_textures(value):
    if isinstance(value, dict):
        for key in list(value):
            if 'Texture' in key: del value[key]
            else: remove_textures(value[key])
    elif isinstance(value, list):
        for item in value: remove_textures(item)
remove_textures(doc.get('materials', []))
doc.pop('textures', None); doc.pop('images', None)
for key in ('extensionsUsed', 'extensionsRequired'):
    if key in doc: doc[key] = [v for v in doc[key] if v != 'KHR_texture_basisu']
jb = json.dumps(doc).encode(); jb += b' ' * ((-len(jb)) % 4)
tail = raw[20+jsize:]
clean = os.path.join(OUT, 'geometry-reference.glb')
open(clean, 'wb').write(struct.pack('<III', 0x46546c67, 2, 20+len(jb)+len(tail)) + struct.pack('<II', len(jb), 0x4e4f534a) + jb + tail)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=clean)
table = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def fingerprint():
    h = hashlib.sha256()
    for o in table:
        h.update(o.name.encode())
        for v in o.data.vertices: h.update(struct.pack('<3f', *v.co))
        for p in o.data.polygons: h.update(struct.pack('<'+'I'*len(p.vertices), *p.vertices))
        h.update(str(o.matrix_world).encode())
    return h.hexdigest()
initial = fingerprint()
print('MODEL', [(o.name, tuple(o.dimensions)) for o in table], flush=True)
points = [o.matrix_world @ Vector(p) for o in table for p in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
print('BOUNDS', lo, hi, flush=True)

def rgb(h):
    v = [int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(((x+.055)/1.055)**2.4 if x>.04045 else x/12.92 for x in v)+(1,)

def surface(name, color, rough=.4, metal=.0, wood=False, stripe=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    n=m.node_tree.nodes; l=m.node_tree.links; bs=n.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=rgb(color)
    bs.inputs['Roughness'].default_value=rough; bs.inputs['Metallic'].default_value=metal
    tc=n.new('ShaderNodeTexCoord'); mapping=n.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
    l.new(tc.outputs['Generated'],mapping.inputs[0]); mapping.inputs[1].default_value=(3,75,12) if wood else (85,85,85)
    noise=n.new('ShaderNodeTexNoise'); l.new(mapping.outputs['Vector'],noise.inputs['Vector']); noise.inputs['Scale'].default_value=2
    noise.inputs['Detail'].default_value=3
    ramp=n.new('ShaderNodeValToRGB'); l.new(noise.outputs['Fac'],ramp.inputs[0])
    base=rgb(color)
    ramp.color_ramp.elements[0].position=.18; ramp.color_ramp.elements[0].color=tuple(v*.40 for v in base[:3])+(1,)
    ramp.color_ramp.elements[1].position=.80; ramp.color_ramp.elements[1].color=base
    l.new(ramp.outputs['Color'],bs.inputs['Base Color'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.18; bump.inputs['Distance'].default_value=.045
    l.new(noise.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],bs.inputs['Normal'])
    if stripe:
        # A painted double coachline on the existing fascia; no decal geometry.
        sep=n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Generated'],sep.inputs[0])
        masks=[]
        for a,b in ((.35,.365),(.39,.405)):
            gt=n.new('ShaderNodeMath'); gt.operation='GREATER_THAN'; gt.inputs[1].default_value=a; l.new(sep.outputs['Z'],gt.inputs[0])
            lt=n.new('ShaderNodeMath'); lt.operation='LESS_THAN'; lt.inputs[1].default_value=b; l.new(sep.outputs['Z'],lt.inputs[0])
            mul=n.new('ShaderNodeMath'); mul.operation='MULTIPLY'; l.new(gt.outputs[0],mul.inputs[0]); l.new(lt.outputs[0],mul.inputs[1]); masks.append(mul)
        add=n.new('ShaderNodeMath'); add.operation='ADD'; l.new(masks[0].outputs[0],add.inputs[0]); l.new(masks[1].outputs[0],add.inputs[1])
        mix=n.new('ShaderNodeMixRGB'); l.new(add.outputs[0],mix.inputs[0]); l.new(ramp.outputs['Color'],mix.inputs[1]); mix.inputs[2].default_value=rgb(stripe); l.new(mix.outputs[0],bs.inputs['Base Color'])
    return m

SKINS = [
    dict(id='federation-finals', name='Federation Finals', wood='754625', outer='163F50', inner='244E59', trim='C5964A', base='35291E', light='E9C480', pitch='193C35', accent='D4B575'),
    dict(id='starport-salvage', name='Starport Salvage', wood='98603C', outer='C0B79A', inner='3C6667', trim='BD6537', base='334D50', light='C6DBCB', pitch='354B44', accent='A9673E'),
    dict(id='saucer-social-club', name='Saucer Social Club', wood='492924', outer='6C2941', inner='343E36', trim='B6A47A', base='342526', light='D7BCA1', pitch='29453C', accent='D2B680'),
]
slots = {o.name:[s.material.name if s.material else '' for s in o.material_slots] for o in table}

# Presentation field is separate from the source GLB, as it is in the game.
bpy.ops.mesh.primitive_plane_add(size=2, location=(0,0,-.08))
field=bpy.context.object; field.name='Preview pitch (separate from table mesh)'; field.scale=(59,33,1)
def pitch_material(color, accent):
    m=surface('Matching preview cloth',color,.82)
    n=m.node_tree.nodes; l=m.node_tree.links; bs=n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Generated'],sep.inputs[0])
    # Flat, conventional football markings remain easy to read.
    def mathnode(op,a,b):
        q=n.new('ShaderNodeMath'); q.operation=op
        if isinstance(a,(int,float)): q.inputs[0].default_value=a
        else: l.new(a,q.inputs[0])
        if isinstance(b,(int,float)): q.inputs[1].default_value=b
        else: l.new(b,q.inputs[1])
        return q.outputs[0]
    x=mathnode('SUBTRACT',sep.outputs['X'],.5); y=mathnode('SUBTRACT',sep.outputs['Y'],.5)
    ax=mathnode('ABSOLUTE',x,0); ay=mathnode('ABSOLUTE',y,0)
    mid=mathnode('LESS_THAN',ax,.0017)
    d=mathnode('SQRT',mathnode('ADD',mathnode('MULTIPLY',x,x), mathnode('MULTIPLY',mathnode('MULTIPLY',y,y),.313)),0)
    ring=mathnode('LESS_THAN',mathnode('ABSOLUTE',mathnode('SUBTRACT',d,.102),0),.0017)
    border=mathnode('MAXIMUM', mathnode('GREATER_THAN',ax,.463),mathnode('GREATER_THAN',ay,.445))
    box=mathnode('MULTIPLY',mathnode('GREATER_THAN',ax,.34),mathnode('LESS_THAN',ay,.25))
    edge=mathnode('MAXIMUM',mathnode('LESS_THAN',mathnode('ABSOLUTE',mathnode('SUBTRACT',ax,.342),0),.0017),mathnode('LESS_THAN',mathnode('ABSOLUTE',mathnode('SUBTRACT',ay,.248),0),.003))
    mask=mathnode('MAXIMUM',mathnode('MAXIMUM',mid,ring),mathnode('MAXIMUM',border,mathnode('MULTIPLY',box,edge)))
    old=bs.inputs['Base Color'].links[0].from_socket
    mix=n.new('ShaderNodeMixRGB'); l.new(mask,mix.inputs[0]); l.new(old,mix.inputs[1]); mix.inputs[2].default_value=rgb(accent); l.new(mix.outputs[0],bs.inputs['Base Color'])
    return m

def fascia_graphics(mat, style, ink):
    """Paint graphics into the material, without adding or displacing geometry."""
    n=mat.node_tree.nodes; l=mat.node_tree.links; bs=n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Generated'],sep.inputs[0])
    def op(kind,a,b=0):
        q=n.new('ShaderNodeMath'); q.operation=kind
        for i,v in enumerate((a,b)):
            if isinstance(v,(int,float)): q.inputs[i].default_value=v
            else: l.new(v,q.inputs[i])
        return q.outputs[0]
    x=sep.outputs['X']; z=sep.outputs['Z']
    if style=='starport-salvage':
        end=op('GREATER_THAN',op('ABSOLUTE',op('SUBTRACT',x,.5)),.30)
        bars=op('GREATER_THAN',op('PINGPONG',op('ADD',op('MULTIPLY',x,31),op('MULTIPLY',z,7)),1),.54)
        band=op('MULTIPLY',op('GREATER_THAN',z,.16),op('LESS_THAN',z,.66))
        mask=op('MULTIPLY',op('MULTIPLY',end,bars),band)
        # Abraded industrial paint, more exposed at the extremities.
        noise=n.new('ShaderNodeTexNoise'); l.new(tc.outputs['Generated'],noise.inputs['Vector']); noise.inputs['Scale'].default_value=180
        mask=op('MULTIPLY',mask,op('GREATER_THAN',noise.outputs['Fac'],.38))
    else:
        # Repeated brass diamonds reminiscent of old pub furniture and club crests.
        repeat=op('ABSOLUTE',op('SUBTRACT',op('PINGPONG',op('MULTIPLY',x,12),1),.5))
        vertical=op('ABSOLUTE',op('SUBTRACT',z,.57))
        dist=op('ADD',repeat,op('MULTIPLY',vertical,4))
        mask=op('MULTIPLY',op('LESS_THAN',dist,.26),op('GREATER_THAN',dist,.20))
    old=bs.inputs['Base Color'].links[0].from_socket
    mix=n.new('ShaderNodeMixRGB'); l.new(mask,mix.inputs[0]); l.new(old,mix.inputs[1]); mix.inputs[2].default_value=rgb(ink); l.new(mix.outputs[0],bs.inputs['Base Color'])

bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,lo.z-.2))
floor=bpy.context.object; floor.data.materials.append(surface('Studio floor','151F25',.65))
target=(lo+hi)/2
bpy.ops.object.camera_add(location=target+Vector((160,-205,155)))
camera=bpy.context.object; camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=184; bpy.context.scene.camera=camera
def area(loc, power, size, color):
    bpy.ops.object.light_add(type='AREA',location=target+Vector(loc)); o=bpy.context.object; o.data.energy=power; o.data.shape='DISK'; o.data.size=size; o.data.color=color; o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
area((0,-90,155),650000,130,(1,.91,.8)); area((100,80,115),500000,100,(.74,.86,1)); area((-120,-20,70),400000,100,(.85,.92,1))
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.world.color=(.13,.13,.13); scene.view_settings.view_transform='AgX'
scene.render.resolution_x=1500; scene.render.resolution_y=1120; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
for skin in SKINS:
    mats={
      'arena_crease':surface('Worn timber ramp',skin['wood'],.43,wood=True),
      'arena_wall':surface('Inner enamel',skin['inner'],.38,.15),
      'arena_wall_outer':surface('Club fascia',skin['outer'],.37,.12,stripe=skin['accent']),
      'Gold':surface('Aged hardware',skin['trim'],.3,.78),
      'Metal2':surface('Dark hardware','20292A',.43,.6),
      'Material':surface('Dark inserts',skin['base'],.5),
      'table_base':surface('Timber pedestal',skin['base'],.48,wood=True),
      'led':surface('Existing lip diffuser',skin['light'],.38,.2),
      'goal_net':surface('Goal net','A3A9A0',.75),
    }
    if skin['id']!='federation-finals': fascia_graphics(mats['arena_wall_outer'],skin['id'],skin['accent'])
    for o in table:
        for i,key in enumerate(slots[o.name]): o.material_slots[i].material=mats.get(key) or mats[key.rsplit('.',1)[0]]
    # Net meshes are translucent boxes in the shipped model; retain their transparency.
    net=mats['goal_net']; bs=net.node_tree.nodes.get('Principled BSDF'); bs.inputs['Alpha'].default_value=.12; net.surface_render_method='DITHERED'
    field.data.materials.clear(); field.data.materials.append(pitch_material(skin['pitch'],skin['accent']))
    assert fingerprint()==initial, 'Source geometry changed'
    scene.render.filepath=os.path.join(OUT,skin['id']+'.png')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,skin['id']+'.blend'))
    bpy.ops.render.render(write_still=True)
    print('FINISHED',skin['id'],flush=True)
json.dump({'source':SOURCE,'source_sha256':hashlib.sha256(raw).hexdigest(),'mesh_sha256_before':initial,'mesh_sha256_after':fingerprint(),'geometry_unchanged':fingerprint()==initial,'skins':SKINS},open(os.path.join(OUT,'verification.json'),'w'),indent=2)
