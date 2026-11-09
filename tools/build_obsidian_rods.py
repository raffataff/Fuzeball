"""Build the four Obsidian Volt rod models from the game's classic rod masters."""
import bpy, math, os, tempfile
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','obsidian_volt'); os.makedirs(OUT,exist_ok=True)
MAPS=os.path.join(OUT,'textures'); os.makedirs(MAPS,exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'tools','build','obsidian-rod-temp'); os.makedirs(tempfile.tempdir,exist_ok=True)

def image(name,space):
    im=bpy.data.images.load(os.path.join(ROOT,'assets','tables','circuit','obsidian',name+'.png'),check_existing=False)
    im.colorspace_settings.name=space; _=im.pixels[0]; im.scale(512,512)
    im.filepath_raw=os.path.join(MAPS,name+'.png'); im.file_format='PNG'; im.save(); return im

images=[image('foot_basecolor','sRGB'),image('foot_roughness','Non-Color'),
        image('foot_metallic','Non-Color'),image('foot_normal','Non-Color'),image('foot_emissive','sRGB')]

def carbon_material():
    m=bpy.data.materials.new('Obsidian Volt | forged carbon grip'); m.use_nodes=True
    nodes=m.node_tree.nodes; links=m.node_tree.links; p=nodes.get('Principled BSDF')
    def tex(img):
        n=nodes.new('ShaderNodeTexImage'); n.image=img; n.interpolation='Linear'; return n
    for im,slot in zip(images[:3],('Base Color','Roughness','Metallic')): links.new(tex(im).outputs['Color'],p.inputs[slot])
    normal=nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=.7
    links.new(tex(images[3]).outputs['Color'],normal.inputs['Color']); links.new(normal.outputs['Normal'],p.inputs['Normal'])
    links.new(tex(images[4]).outputs['Color'],p.inputs['Emission Color']); p.inputs['Emission Strength'].default_value=.5
    return m

def solid(name,color,metal,rough,emit=None):
    m=bpy.data.materials.new(name); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if emit: p.inputs['Emission Color'].default_value=(*emit,1); p.inputs['Emission Strength'].default_value=1
    return m

def bounds(o):
    pts=[o.matrix_world@Vector(p) for p in o.bound_box]
    return min(p.y for p in pts),max(p.y for p in pts)

created=[]
def keep(o,name,mat):
    o.name=name; o.data.materials.append(mat); created.append(o)
    for f in o.data.polygons: f.use_smooth=(len(f.vertices)==4)
    return o

def cylinder(name,y,r,depth,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=depth,location=(0,y,0),rotation=(math.pi/2,0,0))
    return keep(bpy.context.object,name,mat)

def ring(name,y,r,minor,mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,location=(0,y,0),rotation=(math.pi/2,0,0),major_radius=r,minor_radius=minor)
    return keep(bpy.context.object,name,mat)

def radius(t,theta):
    taper=math.sin(math.pi*t)**.8
    return 1.13+.30*taper-.085*taper*(.5+.5*math.cos(5*theta-2*math.pi*t))

def grip(name,y0,y1,carbon,rubber):
    sides=80; steps=56; verts=[]; faces=[]
    for k in range(steps+1):
        t=k/steps
        for j in range(sides):
            a=2*math.pi*j/sides+2*math.pi*t/5; r=radius(t,a)
            verts.append((r*math.cos(a),y0+(y1-y0)*t,r*math.sin(a)))
    for k in range(steps):
        for j in range(sides): faces.append((k*sides+j,(k+1)*sides+j,(k+1)*sides+(j+1)%sides,k*sides+(j+1)%sides))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); mesh.materials.append(carbon); mesh.materials.append(rubber); created.append(o)
    uv=mesh.uv_layers.new(name='GripUV')
    for poly in mesh.polygons:
        k=poly.index//sides; j=poly.index%sides
        for li,coord in zip(poly.loop_indices,[(j/sides,k/steps),(j/sides,(k+1)/steps),((j+1)/sides,(k+1)/steps),((j+1)/sides,k/steps)]): uv.data[li].uv=coord
        t=(k+.5)/steps; a=2*math.pi*(j+.5)/sides
        poly.material_index=1 if math.cos(5*a)>.15 and .07<t<.93 else 0
        poly.use_smooth=True

def trace(name,y0,y1,angle,mat):
    curve=bpy.data.curves.new(name,'CURVE'); curve.dimensions='3D'; curve.bevel_depth=.022; curve.bevel_resolution=2
    spline=curve.splines.new('POLY'); count=65; spline.points.add(count-1)
    for i,p in enumerate(spline.points):
        t=.10+.80*i/(count-1); a=angle+2*math.pi*t/5; r=radius(t,a)+.014
        p.co=(r*math.cos(a),y0+(y1-y0)*t,r*math.sin(a),1)
    o=bpy.data.objects.new(name,curve); bpy.context.collection.objects.link(o); curve.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o; bpy.ops.object.convert(target='MESH'); created.append(bpy.context.object)

def collar_trace(name,y0,y1,angle,mat):
    curve=bpy.data.curves.new(name,'CURVE'); curve.dimensions='3D'; curve.bevel_depth=.014; curve.bevel_resolution=2
    spline=curve.splines.new('POLY'); points=[(.31,-.12),(.38,-.12),(.45,.10),(.63,.10),(.70,-.08)]; spline.points.add(len(points)-1)
    for p,(t,turn) in zip(spline.points,points):
        a=angle+turn; p.co=(1.152*math.cos(a),y0+(y1-y0)*t,1.152*math.sin(a),1)
    o=bpy.data.objects.new(name,curve); bpy.context.collection.objects.link(o); curve.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o; bpy.ops.object.convert(target='MESH'); created.append(bpy.context.object)

def merge_details():
    # Merge the small decorative pieces by material to avoid dozens of draw calls per rod.
    groups={}
    for o in created:
        if o.type=='MESH' and len(o.data.materials)==1: groups.setdefault(o.data.materials[0],[]).append(o)
    for i,(material,obs) in enumerate(groups.items()):
        if len(obs)<2: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs: o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0]; bpy.ops.object.join(); merged=bpy.context.object
        for p in merged.data.polygons: p.material_index=0
        merged.data.materials.clear(); merged.data.materials.append(material); merged.name='obsidian_hardware_'+str(i)

for count in (1,2,3,5):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False); created.clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','classic','rods',f'fuzeball_rod_{count}man.glb'))
    old=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle' in o.name.lower()); y0,y1=bounds(old); bpy.data.objects.remove(old,do_unlink=True)
    carbon=carbon_material(); rubber=solid('Obsidian Volt | tactile graphite',(.018,.027,.034),.08,.56)
    gunmetal=solid('Obsidian Volt | machined gunmetal',(.105,.15,.18),.82,.27)
    black=solid('Obsidian Volt | black ceramic',(.012,.020,.027),.35,.26)
    cyan=solid('Obsidian Volt | cyan light',(.018,.23,.28),.25,.3,(.025,.70,.85))
    grip(f'rod{count}_handle_obsidian_grip',y0,y1,carbon,rubber)
    for i in range(5): trace(f'rod{count}_handle_spiral_{i}',y0,y1,i*2*math.pi/5+.3,cyan)
    for i,t in enumerate((.025,.075,.925,.975)):
        y=y0+(y1-y0)*t; ring(f'rod{count}_handle_bezel_{i}',y,1.18,.055,gunmetal)
    for i,t in enumerate((.055,.945)):
        y=y0+(y1-y0)*t; ring(f'rod{count}_handle_light_{i}',y,1.22,.023,cyan)
    knob=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'knob' in o.name.lower()); tip,end=bounds(knob); span=end-tip
    cylinder(f'rod{count}_handle_cap_body',tip+span*.5,1.71,span*.55,black)
    for i,t in enumerate((.19,.25,.75,.81)): ring(f'rod{count}_handle_cap_trim_{i}',tip+span*t,1.69,.045,gunmetal)
    for i,t in enumerate((.28,.72)): ring(f'rod{count}_handle_cap_light_{i}',tip+span*t,1.73,.025,cyan)
    cylinder(f'rod{count}_handle_endplate',tip-.045,1.43,.10,gunmetal)
    cylinder(f'rod{count}_handle_endplate_inset',tip-.11,.98,.055,black)
    for i,r in enumerate((.46,.94,1.31)): ring(f'rod{count}_handle_endplate_ring_{i}',tip-.145,r,.027,cyan if i==1 else gunmetal)
    cylinder(f'rod{count}_handle_endplate_core',tip-.155,.31,.04,cyan)
    collar=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'collar' in o.name.lower()); c0,c1=bounds(collar)
    cylinder(f'rod{count}_collar_sleeve',(c0+c1)/2,1.14,(c1-c0)*.55,carbon)
    for i in range(6): collar_trace(f'rod{count}_collar_trace_{i}',c0,c1,i*math.pi/3,cyan)
    for i,t in enumerate((.10,.18,.82,.90)): ring(f'rod{count}_collar_bezel_{i}',c0+(c1-c0)*t,1.10,.05,gunmetal)
    for i,t in enumerate((.21,.79)): ring(f'rod{count}_collar_light_{i}',c0+(c1-c0)*t,1.16,.025,cyan)
    cylinder(f'rod{count}_collar_endplate',c1+.04,1.03,.09,gunmetal)
    cylinder(f'rod{count}_collar_inset',c1+.095,.72,.035,black)
    ring(f'rod{count}_collar_face_ring',c1+.12,.67,.028,cyan)
    merge_details()
    out=os.path.join(OUT,f'fuzeball_rod_{count}man.glb')
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_yup=True,export_apply=True)
    print('Wrote',out)
