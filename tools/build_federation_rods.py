"""Export the Federation Finals hardware on the Arena Comet shafts and bumpers.

Run node tools/build_federation_hardware.mjs first, then Blender in background
with --factory-startup --python tools/build_federation_rods.py.
"""

import math
import sys
from pathlib import Path

import bpy

TOOLS = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(TOOLS))
from arena_rod_hardware import SEGMENTS, Surface, extents, full, part, trim

ROOT = TOOLS.parent
OUT = ROOT / 'assets' / 'rods' / 'federation_finals'
MAPS = TOOLS / 'build' / 'federation-hardware' / 'maps'
LENS_SECTORS = [j for j in range(SEGMENTS) if 1 <= j % 18 < 17]


def image(nodes, kind, channel, space):
    node = nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.load(str(MAPS / f'{kind}_{channel}.png'), check_existing=True)
    node.image.colorspace_settings.name = space
    node.extension = 'EXTEND' if kind == 'medallion' else 'REPEAT'
    return node.outputs['Color']


def pbr(name, kind, glow=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    links.new(image(nodes, kind, 'basecolor', 'sRGB'), bsdf.inputs['Base Color'])
    normal = nodes.new('ShaderNodeNormalMap')
    links.new(image(nodes, kind, 'normal', 'Non-Color'), normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    channels = nodes.new('ShaderNodeSeparateColor')
    links.new(image(nodes, kind, 'orm', 'Non-Color'), channels.inputs['Color'])
    links.new(channels.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(channels.outputs['Blue'], bsdf.inputs['Metallic'])
    if glow:
        links.new(image(nodes, kind, 'emissive', 'sRGB'), bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = glow
    return mat


def lens(a, b, r):
    span = b - a
    profile = [(a, r-.059), (a+.14*span, r-.018), (a+.30*span, r),
               (b-.30*span, r), (b-.14*span, r-.018), (b, r-.059)]

    def roll_edge(_t, j):
        d = abs(j % 18 - 9)
        return -.026 * max(0, (d-6)/2) ** 2

    return (profile, LENS_SECTORS, roll_edge, (a, b))


def grip(name, start, end, mat):
    def radius(t):
        # Swell under the palm, taper into the cast ferrule at the shaft end.
        return 1.37 - .29 * t + .211 * math.sin(math.pi * t) ** 1.1

    def grooves(t, j):
        side = .5 + .5 * math.cos(math.tau * j * 8 / SEGMENTS)
        well = max(0, 1 - ((t - .54) / .44) ** 2) ** 1.7
        return -.225 * side ** 1.6 * well

    mesh = Surface(start, end)
    mesh.add([(i/48, radius(i/48)) for i in range(49)], relief=grooves)
    mesh.mesh(name + '_handle_walnut_grip', mat)


def medallion(name, start, end, mat):
    face = Surface(start, end)
    face.add([(.026,.001), (.026,.96), (.039,1.10), (.057,1.17)])
    obj = face.mesh(name + '_handle_medallion', mat)
    # Project the badge on the end face. The others use an axial unwrap.
    uv = obj.data.uv_layers.active
    for loop in obj.data.loops:
        x, _, z = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (.5 + x/2.46, .5 - z/2.46)


def handle(name, start, end, mats):
    span = end - start
    grip(name, start+.177*span, start+.833*span, mats['wood'])
    medallion(name, start, end, mats['badge'])
    part(name + '_handle_knob', start, end, mats, {
        'bronze': [full([(.058,1.13), (.058,1.34), (.076,1.43), (.086,1.28),
                         (.146,1.28), (.157,1.41), (.19,1.41), (.205,1.30)])],
        'alloy': [full([(.056,1.14), (.039,1.22), (.042,1.36), (.058,1.49), (.075,1.49), (.088,1.34)]),
                  trim(.143,.177,1.49), trim(.178,.202,1.43)],
        'team_glow': [lens(.082,.146,1.370)],
    })
    part(name + '_handle_neck', start, end, mats, {
        'bronze': [full([(.811,1.12), (.844,1.23), (.949,1.23), (.995,.68), (1,.39)])],
        'enamel': [([(.837,1.178), (.850,1.265), (.933,1.265), (.948,1.178)],
                    range(SEGMENTS), None, (.837,.948))],
        'alloy': [trim(.815,.849,1.265), trim(.932,.964,1.279),
                  full([(.960,1.19), (.977,1.12), (.993,1.01), (1,.70), (1,.39)])],
    })


def collar(name, start, end, mats):
    part(name + '_end_collar', start, end, mats, {
        'bronze': [full([(0,.393), (0,.71), (.05,.84), (.12,.98), (.228,1.04), (.282,.865),
                         (.644,.865), (.699,1.02), (.903,1.027), (.959,.947), (1,.83),
                         (1,.68), (.971,.625), (.971,.51), (.987,.46), (.987,.40), (0,.393)])],
        'alloy': [full([(.008,.688), (.01,.909), (.049,1.013), (.115,1.093), (.216,1.108), (.248,1.015)]),
                  trim(.650,.736,1.076), trim(.894,.976,1.107)],
        'enamel': [([(.731,1.037), (.765,1.073), (.878,1.073), (.906,1.034)],
                    range(SEGMENTS), None, (.731,.906))],
        'team_glow': [lens(.270,.659,.973)],
    })


OUT.mkdir(parents=True, exist_ok=True)
mats = {
    'wood': pbr('Federation | carved walnut', 'walnut'),
    'alloy': pbr('Federation | turned brass', 'brass'),
    'enamel': pbr('Federation | enamel and gold inlay', 'enamel'),
    'badge': pbr('Federation | struck brass medallion', 'medallion'),
    'bronze': pbr('Federation | blackened bronze', 'bronze'),
    'team_glow': pbr('team_glow_federation', 'lens', 1.07),
}
for count in (1, 2, 3, 5):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    filename = f'fuzeball_rod_{count}man.glb'
    bpy.ops.import_scene.gltf(filepath=str(OUT.parent / 'arena_comet' / filename))
    old = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and
           any(tag in obj.name.lower() for tag in ('_handle', '_knob', '_collar'))]
    stop, = [obj for obj in old if '_collar' in obj.name.lower()]
    handles = [extents(obj) for obj in old if obj != stop]
    h0, h1 = min(a for a, _ in handles), max(b for _, b in handles)
    c0, c1 = extents(stop)
    for obj in old:
        bpy.data.objects.remove(obj, do_unlink=True)
    handle(f'rod{count}', h0, h1, mats)
    collar(f'rod{count}', c0, c1, mats)
    bpy.ops.export_scene.gltf(filepath=str(OUT / filename), export_format='GLB',
                              export_yup=True, export_apply=True, export_tangents=True)
