"""Build the Helios Runners handles and end collars onto the stock rod shafts."""

import math
import sys
from functools import partial
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'rods' / 'helios_runners'
MAPS = OUT / 'textures'
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from arena_rod_hardware import SEGMENTS, Surface, extents, full, part, trim

part = partial(part, uv_name='HeliosWrap')
WINDOWS = [i for i in range(SEGMENTS) if 2 <= i % 12 < 10]


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def band(x, a, b, edge):
    return smooth(a, a + edge, x) * (1 - smooth(b - edge, b, x))


def linear_rgb(hex_rgb):
    rgb = [int(hex_rgb[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in rgb)


def image_node(material, file_name, space):
    node = material.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.load(str(MAPS / (file_name + '.png')), check_existing=True)
    node.image.colorspace_settings.name = space
    return node


def material(name, color, metal, roughness, normal=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*linear_rgb(color), 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    if normal:
        bump = nodes.new('ShaderNodeNormalMap')
        links.new(image_node(mat, normal, 'Non-Color').outputs['Color'], bump.inputs['Color'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def texture_input(mat, image, space, socket):
    mat.node_tree.links.new(
        image_node(mat, image, space).outputs['Color'],
        mat.node_tree.nodes.get('Principled BSDF').inputs[socket],
    )


def finishes():
    grip = material('Helios | molded racing grip', 'ffffff', 1, 1, 'grip_normal')
    nodes, links = grip.node_tree.nodes, grip.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    links.new(image_node(grip, 'grip_basecolor', 'sRGB').outputs['Color'], bsdf.inputs['Base Color'])
    channels = nodes.new('ShaderNodeSeparateColor')
    links.new(image_node(grip, 'grip_orm', 'Non-Color').outputs['Color'], channels.inputs['Color'])
    links.new(channels.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(channels.outputs['Blue'], bsdf.inputs['Metallic'])

    alloy = material('Helios | turned champagne alloy', 'c7ad83', .93, .3, 'hardware_normal')
    texture_input(alloy, 'hardware_roughness', 'Non-Color', 'Roughness')
    glow = material('team_glow_helios', 'ffffff', 0, .34, 'lens_normal')
    texture_input(glow, 'lens_basecolor', 'sRGB', 'Base Color')
    texture_input(glow, 'lens_roughness', 'Non-Color', 'Roughness')
    texture_input(glow, 'lens_emissive', 'sRGB', 'Emission Color')
    glow.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = 1.06
    # The neutral diffuser maps are multiplied by the current kit colour in game.
    return {
        'grip': grip, 'alloy': alloy, 'team_glow': glow,
        'graphite': material('Helios | blackened alloy', '554f4b', .57, .48, 'hardware_normal'),
        'gasket': material('Helios | graphite gasket', '292728', 0, .73),
        'enamel': material('Helios | solar orange enamel', 'ec591b', .04, .32),
    }


def lens(t0, t1, radius, dome):
    span = t1 - t0
    return ([(t0, radius - dome), (t0 + span * .10, radius - dome * .20),
             (t0 + span * .25, radius), (t1 - span * .25, radius),
             (t1 - span * .10, radius - dome * .20), (t1, radius - dome)],
            WINDOWS, lambda _t, j: -dome * .65 * smooth(2, 4, abs(j % 12 - 6)), (t0, t1))


def bezel(t0, t1, radius, rise):
    # Raised bridges protect the optical inserts and connect the two metal rims.
    profile = [(t0, radius), (t0 + .022, radius), (t1 - .022, radius), (t1, radius)]
    return (profile, range(SEGMENTS),
            lambda t, j: rise * smooth(3, 5, abs(j % 12 - 6)) * band(t, t0, t1, .021))


def handle(name, start, end, mats):
    body = [(0, 1.06), (.027, 1.20), (.063, 1.25), (.12, 1.25), (.22, 1.30),
            (.35, 1.38), (.5, 1.33), (.65, 1.37), (.77, 1.35), (.90, 1.26),
            (.952, 1.20), (.985, 1.08), (1, .94)]
    stations = sorted({i / 132 for i in range(133)} | {t for t, _ in body})
    profile = []
    for t in stations:
        lo, hi = next((lo, hi) for lo, hi in zip(body, body[1:]) if lo[0] <= t <= hi[0])
        f = (t - lo[0]) / (hi[0] - lo[0])
        profile.append((t, lo[1] + f * (hi[1] - lo[1])))

    def tread(t, j):
        lane = abs((j / SEGMENTS * 6 + .5) % 1 - .5)
        pad = 1 - smooth(.29, .44, lane)
        shift = t - .11 * lane
        rib = abs((shift * 18 + .5) % 1 - .5)
        groove = (1 - smooth(.12, .37, rib)) * band(t, .226, .81, .039)
        return (.12 * pad - .125 * groove * pad - .035) * band(t, .047, .963, .09)

    grip = Surface(start, end, 'HeliosWrap')
    grip.add(profile, relief=tread)
    grip.mesh(name + '_handle_helios_grip', mats['grip'])
    part(name + '_handle_neck', end - .55, end + .005, mats, {
        'graphite': [full([(0, 1.14), (.13, 1.28), (.44, 1.28), (.53, 1.20),
                           (.64, .98), (.79, .95), (.94, .91), (1, .41)])],
        'alloy': [trim(.15, .47, 1.305)],
        'gasket': [trim(.58, .73, 1.03)],
    })


def knob(name, start, end, mats):
    part(name + '_handle_knob', start, end, mats, {
        'graphite': [full([(.051, .001), (.051, .51), (.026, .63), (.026, .99),
                           (.004, 1.09), (.004, 1.37), (.037, 1.55), (.079, 1.62),
                           (.23, 1.62), (.274, 1.53), (.326, 1.25), (.651, 1.25),
                           (.70, 1.49), (.74, 1.53), (.84, 1.53), (.935, 1.43), (1, 1.10)])],
        'alloy': [trim(.080, .206, 1.67), trim(.751, .825, 1.585),
                  full([(.003, 1.088), (.003, 1.40), (.028, 1.54)]),
                  ([(.047, .28), (.047, .51), (.028, .62)], range(2, 70))],
        'gasket': [bezel(.268, .715, 1.28, .195), trim(.229, .258, 1.595)],
        'team_glow': [lens(.330, .655, 1.41, .09)],
        'enamel': [trim(.866, .897, 1.526), ([(.024, .72), (.024, .96)], range(7, 24))],
    })


def collar(name, start, end, mats):
    part(name + '_end_collar', start, end, mats, {
        'graphite': [full([(0, .395), (0, .64), (.032, .75), (.032, .89),
                           (.066, 1.01), (.12, 1.09), (.24, 1.08), (.31, .81),
                           (.66, .81), (.73, 1.035), (.79, 1.09), (.898, 1.09),
                           (.958, 1.04), (1, .89), (1, .40), (0, .395)])],
        'alloy': [trim(.115, .218, 1.13), trim(.800, .899, 1.13),
                  full([(.004, .73), (.004, .98), (.056, 1.055)])],
        'gasket': [bezel(.252, .736, .844, .162), trim(.932, .963, 1.068)],
        'team_glow': [lens(.302, .678, .947, .067)],
        'enamel': [trim(.755, .79, 1.119)],
    })


mats = finishes()
for count in (1, 2, 3, 5):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    file_name = f'fuzeball_rod_{count}man.glb'
    bpy.ops.import_scene.gltf(filepath=str(OUT.parent / file_name))
    original = {
        kind: next(o for o in bpy.context.scene.objects if o.type == 'MESH' and f'_{kind}' in o.name.lower())
        for kind in ('handle', 'knob', 'collar')
    }
    bounds = {kind: extents(obj) for kind, obj in original.items()}
    for obj in original.values():
        bpy.data.objects.remove(obj, do_unlink=True)
    name = f'rod{count}'
    handle(name, *bounds['handle'], mats)
    knob(name, *bounds['knob'], mats)
    collar(name, *bounds['collar'], mats)
    bpy.ops.export_scene.gltf(filepath=str(OUT / file_name), export_format='GLB',
                              export_yup=True, export_apply=True, export_tangents=True)
