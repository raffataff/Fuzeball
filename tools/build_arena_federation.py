"""Bake the approved Federation Finals concept to a game-ready GLB.

Run: blender -b output/arena-skins-2026-11-08/federation-finals-grand-v2.blend
     --python tools/build_arena_federation.py
"""
import bpy, bmesh, os, tempfile, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tables', 'arena')
MAPS = os.path.join(OUT, 'federation_finals')
os.makedirs(MAPS, exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'output','federation-export-temp')
os.makedirs(tempfile.tempdir,exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
names = ('arena_bowl', 'goal_frame', 'goal_net', 'off_led_ring', 'table_leg_')
objects = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(names)]
assert any(o.name.startswith('arena_bowl') for o in objects)
assert any(o.name.startswith('table_leg_') for o in objects)

def simple(name, color, metal=0, rough=.4, alpha=1):
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,alpha)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    bs.inputs['Alpha'].default_value=alpha
    if alpha<1: mat.surface_render_method='DITHERED'
    return mat

for obj in objects:
    if obj.name.startswith('table_leg_'):
        # The source contains coincident duplicate cross-brace faces. They
        # self-shadow to solid black in the render and z-fight in WebGL. Remove
        # only exact duplicates; the visible surface and all positions stay put.
        bm=bmesh.new(); bm.from_mesh(obj.data); seen=set(); duplicate=[]
        for f in bm.faces:
            key=(f.material_index,tuple(sorted(tuple(round(c,5) for c in v.co) for v in f.verts)))
            if key in seen: duplicate.append(f)
            else: seen.add(key)
        bmesh.ops.delete(bm,geom=duplicate,context='FACES_ONLY')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
        # Imported stand faces have split vertices. Project each face using the
        # direction of the timber member: up the splayed legs, lengthwise on
        # the cross-members. The shear removes the diagonal grain on the legs.
        while obj.data.uv_layers: obj.data.uv_layers.remove(obj.data.uv_layers[0])
        uv=obj.data.uv_layers.new(name='StandWood'); uv.active_render=True
        obj.data.uv_layers.active=uv
        for face in obj.data.polygons:
            coords=[obj.data.vertices[obj.data.loops[i].vertex_index].co for i in face.loop_indices]
            extent=[max(p[k] for p in coords)-min(p[k] for p in coords) for k in range(3)]
            center=sum(coords, __import__('mathutils').Vector())/len(coords)
            for loop,p in zip(face.loop_indices,coords):
                if extent[0]>30: u,v=(p.z+34)/20+.2,(p.x+45)/95
                elif extent[1]>20: u,v=(p.z+34)/20+.2,(p.y+22)/95
                elif extent[2]>25:
                    sign=1 if center.x>=0 else -1
                    across=p.y if abs(face.normal.x)>abs(face.normal.y) else p.x+sign*.50*p.z
                    across_center=center.y if abs(face.normal.x)>abs(face.normal.y) else center.x+sign*.50*center.z
                    u,v=(across-across_center)/20+.5,(p.z+43)/58
                elif abs(center.x)>28 and center.z<-3:
                    sign=1 if center.x>=0 else -1
                    across=p.y if abs(face.normal.x)>abs(face.normal.y) else p.x+sign*.50*p.z
                    across_center=center.y if abs(face.normal.x)>abs(face.normal.y) else center.x+sign*.50*center.z
                    u,v=(across-across_center)/20+.5,(p.z+43)/58
                else: u,v=(p.z+34)/20+.2,(p.x+45)/95
                uv.data[loop].uv=(u,v)
        wood=simple('Federation | bookmatched walnut',(1,1,1),0,.38)
        nodes=wood.node_tree.nodes; links=wood.node_tree.links; bs=nodes.get('Principled BSDF')
        def image_node(file,noncolor=False):
            image=bpy.data.images.load(os.path.join(MAPS,file),check_existing=True)
            if noncolor: image.colorspace_settings.name='Non-Color'
            node=nodes.new('ShaderNodeTexImage'); node.image=image; node.extension='REPEAT'; return node
        base=image_node('walnut_basecolor.png'); links.new(base.outputs['Color'],bs.inputs['Base Color'])
        rough=image_node('walnut_roughness.png',True); links.new(rough.outputs['Color'],bs.inputs['Roughness'])
        normal=image_node('walnut_normal.png',True); nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.55
        links.new(normal.outputs['Color'],nm.inputs['Color']); links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        hardware=simple('Federation | blackened bronze',(.055,.042,.029),.75,.32)
        brass=simple('Federation | antique brass',(.49,.29,.09),.82,.29)
        for slot in obj.material_slots:
            slot.material=wood if slot.material and 'Timber pedestal' in slot.material.name else (brass if slot.material and 'Aged hardware' in slot.material.name else hardware)
    elif obj.name.startswith('arena_bowl'):
        # Pack a non-overlapping bake UV without changing vertex positions.
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        while obj.data.uv_layers: obj.data.uv_layers.remove(obj.data.uv_layers[0])
        # Unwrap the fascia continuously around the oval's perimeter, with
        # vertical UV following the actual wall height. Split only the angle
        # seam, never a face, so the curved corners keep their proportions.
        fascia_uv=obj.data.uv_layers.new(name='FasciaDesign')
        for face in obj.data.polygons:
            pts=[obj.data.vertices[obj.data.loops[i].vertex_index].co for i in face.loop_indices]
            angles=[math.atan2(p.y/41,p.x/72)/(2*math.pi)+.5 for p in pts]
            if max(angles)-min(angles)>.5: angles=[a+1 if a<.5 else a for a in angles]
            for loop,p,a in zip(face.loop_indices,pts,angles): fascia_uv.data[loop].uv=(a*3,(p.z+2.91)/13.22)
        uv=obj.data.uv_layers.new(name='FederationBake'); obj.data.uv_layers.active=uv; uv.active_render=True
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.005)
        bpy.ops.object.mode_set(mode='OBJECT')
        image=bpy.data.images.new(obj.name+'_color', width=4096, height=4096, alpha=False)
        image.generated_color=(.02,.02,.02,1)
        # Bake only surface color. This avoids baking studio lights into the game.
        originals=[]
        for slot in obj.material_slots:
            mat=slot.material.copy(); slot.material=mat
            nodes=mat.node_tree.nodes; links=mat.node_tree.links
            bs=nodes.get('Principled BSDF'); output=nodes.get('Material Output')
            if 'Club fascia' in mat.name:
                source=bpy.data.images.load(os.path.join(MAPS,'fascia_source.png'),check_existing=True)
                coords=nodes.new('ShaderNodeUVMap'); coords.uv_map='FasciaDesign'
                tex=nodes.new('ShaderNodeTexImage'); tex.image=source; tex.extension='REPEAT'
                links.new(coords.outputs['UV'],tex.inputs['Vector'])
                # The lighter brass inlay is metallic; the dark enamel is not.
                bw=nodes.new('ShaderNodeRGBToBW'); links.new(tex.outputs['Color'],bw.inputs[0])
                mask=nodes.new('ShaderNodeMapRange'); mask.clamp=True
                mask.inputs['From Min'].default_value=.07; mask.inputs['From Max'].default_value=.28
                # Bright warm ivory-gold inlays hold their contrast in dark
                # venues; partial metal keeps them legible without relying on
                # a strong environment reflection.
                mask.inputs['To Min'].default_value=.06; mask.inputs['To Max'].default_value=.46
                links.new(bw.outputs[0],mask.inputs['Value']); links.new(mask.outputs['Result'],bs.inputs['Metallic'])
                goldmask=nodes.new('ShaderNodeMapRange'); goldmask.clamp=True
                goldmask.inputs['From Min'].default_value=.035; goldmask.inputs['From Max'].default_value=.20
                links.new(bw.outputs[0],goldmask.inputs['Value'])
                bright=nodes.new('ShaderNodeMixRGB'); links.new(goldmask.outputs['Result'],bright.inputs[0])
                links.new(tex.outputs['Color'],bright.inputs[1]); bright.inputs[2].default_value=(1.0,.72,.35,1)
                links.new(bright.outputs[0],bs.inputs['Base Color'])
                rough=nodes.new('ShaderNodeMapRange'); rough.clamp=True
                rough.inputs['From Min'].default_value=.07; rough.inputs['From Max'].default_value=.28
                rough.inputs['To Min'].default_value=.48; rough.inputs['To Max'].default_value=.35
                links.new(bw.outputs[0],rough.inputs['Value']); links.new(rough.outputs['Result'],bs.inputs['Roughness'])
            if 'Timber pedestal' in mat.name:
                # Long, irregular walnut pores follow the timber instead of the
                # large, flat-looking horizontal bands in the concept.
                coord=nodes.new('ShaderNodeTexCoord'); scale=nodes.new('ShaderNodeVectorMath'); scale.operation='MULTIPLY'
                scale.inputs[1].default_value=(65,65,3); links.new(coord.outputs['Generated'],scale.inputs[0])
                grain=nodes.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value=3; grain.inputs['Detail'].default_value=4
                grain.inputs['Roughness'].default_value=.7; links.new(scale.outputs['Vector'],grain.inputs['Vector'])
                tint=nodes.new('ShaderNodeValToRGB'); links.new(grain.outputs['Fac'],tint.inputs[0])
                tint.color_ramp.elements[0].color=(.34,.23,.15,1); tint.color_ramp.elements[1].color=(.95,.82,.68,1)
                previous=bs.inputs['Base Color'].links[0].from_socket
                grainmix=nodes.new('ShaderNodeMixRGB'); grainmix.blend_type='MULTIPLY'; grainmix.inputs[0].default_value=.32
                links.new(previous,grainmix.inputs[1]); links.new(tint.outputs['Color'],grainmix.inputs[2]); links.new(grainmix.outputs[0],bs.inputs['Base Color'])
                bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.3; bump.inputs['Distance'].default_value=.035
                links.new(grain.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs['Normal'],bs.inputs['Normal'])
                # The gold pattern and timber share one slot. Give inlays a
                # metallic response while leaving the wood dielectric.
                prior=previous.node
                if prior.bl_idname=='ShaderNodeMixRGB':
                    links.new(prior.inputs[0].links[0].from_socket,bs.inputs['Metallic'])
                    inv=nodes.new('ShaderNodeMapRange'); inv.inputs['To Min'].default_value=.52; inv.inputs['To Max'].default_value=.27
                    links.new(prior.inputs[0].links[0].from_socket,inv.inputs['Value']); links.new(inv.outputs['Result'],bs.inputs['Roughness'])
            emission=nodes.new('ShaderNodeEmission')
            base=bs.inputs['Base Color']
            if base.is_linked: links.new(base.links[0].from_socket,emission.inputs['Color'])
            else: emission.inputs['Color'].default_value=base.default_value
            links.new(emission.outputs[0],output.inputs['Surface'])
            tex=nodes.new('ShaderNodeTexImage'); tex.name='__bake_target'; tex.image=image
            nodes.active=tex; originals.append(mat)
        scene.render.bake.margin=8
        bpy.ops.object.bake(type='EMIT')
        image.filepath_raw=os.path.join(MAPS,('bowl' if obj.name.startswith('arena_bowl') else 'pedestal')+'_basecolor.png')
        image.file_format='PNG'; image.save()
        prefix='bowl' if obj.name.startswith('arena_bowl') else 'pedestal'
        def bake_channel(label, channel):
            target=bpy.data.images.new(prefix+'_'+label,width=4096,height=4096,alpha=False)
            target.colorspace_settings.name='Non-Color'
            for mat in originals:
                nodes=mat.node_tree.nodes; links=mat.node_tree.links; bs=nodes.get('Principled BSDF')
                output=nodes.get('Material Output'); emission=next(n for n in nodes if n.bl_idname=='ShaderNodeEmission')
                if label=='normal': links.new(bs.outputs[0],output.inputs['Surface'])
                else:
                    inp=bs.inputs[channel]
                    for link in list(emission.inputs['Color'].links): links.remove(link)
                    if inp.is_linked: links.new(inp.links[0].from_socket,emission.inputs['Color'])
                    else: emission.inputs['Color'].default_value=(inp.default_value,)*3+(1,)
                    links.new(emission.outputs[0],output.inputs['Surface'])
                tex=nodes['__bake_target']; tex.image=target; nodes.active=tex
            bpy.ops.object.bake(type='NORMAL' if label=='normal' else 'EMIT')
            target.filepath_raw=os.path.join(MAPS,prefix+'_'+label+'.png'); target.file_format='PNG'; target.save()
            return target
        rough=bake_channel('roughness','Roughness')
        metal=bake_channel('metallic','Metallic')
        normal=bake_channel('normal',None)
        # Three.js r128 only supports TEXCOORD_0 for base color maps.
        obj.data.uv_layers.remove(obj.data.uv_layers['FasciaDesign'])
        obj.data.uv_layers.active=obj.data.uv_layers['FederationBake']
        obj.data.uv_layers['FederationBake'].active_render=True
        # Keep per-material metallic response while sharing this object's atlas.
        for i,old in enumerate(originals):
            oldbs=old.node_tree.nodes.get('Principled BSDF')
            new=simple('Federation | '+old.name.split('.')[0],(1,1,1),oldbs.inputs['Metallic'].default_value,oldbs.inputs['Roughness'].default_value)
            tex=new.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=image
            new.node_tree.links.new(tex.outputs['Color'],new.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
            bs=new.node_tree.nodes.get('Principled BSDF')
            for img,key in ((rough,'Roughness'),(metal,'Metallic')):
                t=new.node_tree.nodes.new('ShaderNodeTexImage'); t.image=img; new.node_tree.links.new(t.outputs['Color'],bs.inputs[key])
            t=new.node_tree.nodes.new('ShaderNodeTexImage'); t.image=normal
            nm=new.node_tree.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.7
            new.node_tree.links.new(t.outputs['Color'],nm.inputs['Color']); new.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
            obj.material_slots[i].material=new
    elif obj.name.startswith('goal_frame'):
        for slot in obj.material_slots: slot.material=simple('Federation | gold frame',(.55,.29,.075),.78,.30)
    elif obj.name.startswith('goal_net'):
        for slot in obj.material_slots: slot.material=simple('goal_net',(.4,.4,.38),0,.8,.12)
    else:
        for slot in obj.material_slots: slot.material=simple('led',(.75,.58,.3),.2,.38)

bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
target=os.path.join(OUT,'fuzeball_table_arena_federation.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True,export_yup=True)
print('WROTE',target,flush=True)
