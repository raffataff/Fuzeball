import bpy, os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));src=os.path.join(root,'assets/pitches/source/helios_runners')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/pitches/pitch_federation_finals.glb'))
m=bpy.data.materials.new('Helios | black playing surface');m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
def image(name,non=False):
 t=n.new('ShaderNodeTexImage');t.image=bpy.data.images.load(os.path.join(src,name+'.png'))
 if non:t.image.colorspace_settings.name='Non-Color'
 return t
c=image('basecolor');l.new(c.outputs['Color'],p.inputs['Base Color']);mr=image('orm',True);sep=n.new('ShaderNodeSeparateColor');l.new(mr.outputs['Color'],sep.inputs[0]);l.new(sep.outputs['Green'],p.inputs['Roughness']);l.new(sep.outputs['Blue'],p.inputs['Metallic']);nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.35;nt=image('normal',True);l.new(nt.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],p.inputs['Normal'])
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  o.data.materials.clear();o.data.materials.append(m)
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=os.path.join(root,'assets/pitches/pitch_helios_runners.glb'),export_format='GLB',use_selection=True)
