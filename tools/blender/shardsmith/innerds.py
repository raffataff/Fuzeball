"""The "Innerds" material: wet, slightly gory insides whose colour is set per species.

Everything is generated here, so it works in any scene without external files:

- an albedo map (mottled flesh, dark clots, a warped vein network, pale fibres), stored as a GREY value map so that
  multiplying it by the species colour keeps the pattern and changes only the hue,
- a matching tangent-space normal map (raised veins and fibres, pitted clots),
- both tile seamlessly (periodic noise and a wrapped Voronoi), since the fracture faces are UV-projected in repeats.

The node tree is deliberately plain so that it survives glTF export: Principled BSDF, Base Color = albedo x Species
Colour (a Mix node in Multiply mode: exported as the texture and a baseColorFactor), a Normal Map node, and a clearcoat
for the wet look (KHR_materials_clearcoat, which the game's own exports already use). Subsurface is on for Blender
renders; glTF has no equivalent and ignores it.
"""
import numpy as np

import bpy

NAME = "Innerds"
FALLBACK_NAME = "Innerds Gore"
FLAG = "shardsmith_innerds"

SPECIES = [
    ('HUMAN', "Human", "Arterial red"),
    ('ANIMAL', "Animal", "Dark maroon"),
    ('ALIEN_GREEN', "Alien: Green", "Green ichor"),
    ('ALIEN_PURPLE', "Alien: Purple", "Violet ichor"),
    ('ALIEN_BLUE', "Alien: Blue", "Blue ichor"),
    ('CYBORG', "Cyborg", "Amber hydraulic fluid"),
    ('ROBOT', "Robot", "Dark oil"),
]
COLOURS = {   # linear RGB
    'HUMAN': (0.62, 0.035, 0.03, 1.0),
    'ANIMAL': (0.42, 0.028, 0.035, 1.0),
    'ALIEN_GREEN': (0.16, 0.6, 0.05, 1.0),
    'ALIEN_PURPLE': (0.38, 0.05, 0.55, 1.0),
    'ALIEN_BLUE': (0.04, 0.28, 0.7, 1.0),
    'CYBORG': (0.55, 0.22, 0.02, 1.0),
    'ROBOT': (0.07, 0.06, 0.06, 1.0),
}


# ---------------------------------------------------------------------------------------------------------
# textures
# ---------------------------------------------------------------------------------------------------------
def _fbm(n, rng, beta):
    """Periodic noise in 0..1 with a 1/f^beta spectrum."""
    f = np.fft.fftfreq(n)
    k = np.sqrt(f[:, None] ** 2 + f[None, :] ** 2)
    k[0, 0] = 1.0
    spec = np.fft.fft2(rng.standard_normal((n, n))) / (k ** (beta / 2.0))
    spec[0, 0] = 0.0
    a = np.real(np.fft.ifft2(spec))
    a -= a.min()
    return a / max(a.max(), 1e-9)


def _smooth(x, a, b):
    t = np.clip((x - a) / max(b - a, 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _voronoi_edges(n, rng, points, warp):
    """Distance gap F2-F1 of a periodic Voronoi, sampled at warped pixel positions (small near cell borders)."""
    pts = rng.random((points, 2)).astype(np.float32)
    u = (np.arange(n, dtype=np.float32) + 0.5) / n
    gx, gy = np.meshgrid(u, u)
    px = (gx + warp[0]).ravel() % 1.0
    py = (gy + warp[1]).ravel() % 1.0
    f1 = np.full(px.shape, 9.0, np.float32)
    f2 = np.full(px.shape, 9.0, np.float32)
    for q in pts:
        dx = np.abs(px - q[0])
        dy = np.abs(py - q[1])
        dx = np.minimum(dx, 1.0 - dx)
        dy = np.minimum(dy, 1.0 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        new_f2 = np.where(d < f1, f1, np.minimum(f2, d))
        f1 = np.minimum(f1, d)
        f2 = new_f2
    return (f2 - f1).reshape(n, n)


def make_maps(n=512, seed=7):
    """(albedo (n,n) grey 0..1, normal (n,n,3) 0..1) tileable maps."""
    rng = np.random.default_rng(seed)
    mottle = _fbm(n, rng, 3.2)
    mid = _fbm(n, rng, 2.4)
    fine = _fbm(n, rng, 1.4)
    fibre = _fbm(n, rng, 2.0)
    fibre = np.abs(np.sin((fibre * 9.0 + np.arange(n)[None, :] / n * 3.0) * np.pi))       # streaky, roughly horizontal
    warp = ((_fbm(n, rng, 3.0) - 0.5) * 0.09, (_fbm(n, rng, 3.0) - 0.5) * 0.09)
    gap = _voronoi_edges(n, rng, max(28, n // 9), warp)
    vein = 1.0 - _smooth(gap, 0.0, 0.04)                        # 1 on the network, 0 between
    vein_fine = 1.0 - _smooth(_voronoi_edges(n, rng, max(90, n // 3), warp), 0.0, 0.02)
    clot = _smooth(mid + 0.25 * fine, 0.58, 0.82)
    tone = 0.62 + 0.38 * (mottle - 0.5) * 1.6
    tone = tone * (1.0 - 0.5 * clot)                            # dark congealed patches
    tone = tone * (1.0 - 0.5 * vein) * (1.0 - 0.25 * vein_fine)
    tone = tone + 0.14 * fibre * (1.0 - clot)                   # pale fibres, not inside clots
    albedo = np.clip(tone, 0.17, 1.0).astype(np.float32)        # never black: a dark clot stays a saturated dark red
    height = 0.3 * fine + 0.3 * fibre + 0.75 * vein + 0.25 * vein_fine - 0.4 * clot + 0.5 * mottle
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * n * 0.018
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * n * 0.018
    nz = np.ones_like(gx)
    ln = np.sqrt(gx * gx + gy * gy + nz * nz)
    normal = np.stack([-gx / ln, -gy / ln, nz / ln], axis=2) * 0.5 + 0.5
    return albedo, normal.astype(np.float32)


def _image(name, arr, colourspace):
    n = arr.shape[0]
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, n, n, alpha=False, float_buffer=False)
    # The colour space has to be set BEFORE the pixels: changing it afterwards regenerates the buffer and wipes them.
    img.colorspace_settings.name = colourspace
    rgba = np.ones((n, n, 4), np.float32)
    rgba[:, :, :3] = arr[:, :, None] if arr.ndim == 2 else arr
    img.pixels.foreach_set(rgba.ravel())
    # A generated image is only a buffer in memory and is lost when the .blend is saved and reopened, and pack() does
    # nothing for one. Saving it as a PNG first turns it into a file image that pack() can embed.
    import os
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix="innerds_")
    try:
        img.filepath_raw = os.path.join(tmp, name.replace(" ", "_") + ".png")
        img.file_format = 'PNG'
        img.save()
        img.pack()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return img


# ---------------------------------------------------------------------------------------------------------
# the material
# ---------------------------------------------------------------------------------------------------------
def _socket(node, identifier, output=False):
    coll = node.outputs if output else node.inputs
    for s in coll:
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


def _principled(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


def is_innerds(mat):
    return mat is not None and bool(mat.get(FLAG))


def build(size=512, seed=7, colour=None, name=None):
    """A new Innerds material (image maps are generated and packed into the file)."""
    name = name or NAME
    colour = colour or COLOURS['HUMAN']
    mat = bpy.data.materials.new(name)
    mat[FLAG] = True
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    albedo, normal = make_maps(size, seed)
    img_a = _image("%s Albedo" % name, albedo, 'sRGB')
    img_n = _image("%s Normal" % name, normal, 'Non-Color')

    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (700, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (420, 0)
    coord = nt.nodes.new('ShaderNodeTexCoord')
    coord.location = (-720, 0)
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.name = "Pattern Scale"
    mapping.label = "Pattern Scale"
    mapping.location = (-520, 0)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.name = "Gore Albedo"
    ta.label = "Gore Albedo"
    ta.image = img_a
    ta.interpolation = 'Linear'
    ta.extension = 'REPEAT'
    ta.location = (-300, 160)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.name = "Gore Normal"
    tn.label = "Gore Normal"
    tn.image = img_n
    tn.interpolation = 'Linear'
    tn.extension = 'REPEAT'
    tn.location = (-300, -240)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.name = "Species Colour"
    mix.label = "Species Colour"
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.location = (100, 160)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.name = "Bumpiness"
    nmap.label = "Bumpiness"
    nmap.location = (100, -240)
    nmap.inputs['Strength'].default_value = 0.6

    _socket(mix, 'Factor_Float').default_value = 1.0
    _socket(mix, 'B_Color').default_value = colour
    l = nt.links.new
    l(coord.outputs['UV'], mapping.inputs['Vector'])
    l(mapping.outputs['Vector'], ta.inputs['Vector'])
    l(mapping.outputs['Vector'], tn.inputs['Vector'])
    l(ta.outputs['Color'], _socket(mix, 'A_Color'))
    l(_socket(mix, 'Result_Color', True), bsdf.inputs['Base Color'])
    l(tn.outputs['Color'], nmap.inputs['Color'])
    l(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    l(bsdf.outputs['BSDF'], out.inputs['Surface'])

    bsdf.inputs['Roughness'].default_value = 0.3
    bsdf.inputs['Metallic'].default_value = 0.0
    for names, value in ((("Coat Weight", "Clearcoat"), 0.7), (("Coat Roughness", "Clearcoat Roughness"), 0.1),
                         (("Subsurface Weight", "Subsurface"), 0.5), (("Subsurface Scale",), 0.08)):
        s = _principled(bsdf, *names)
        if s is not None:
            s.default_value = value
    sr = _principled(bsdf, "Subsurface Radius")
    if sr is not None:
        sr.default_value = (1.0, 0.18, 0.12)
    mat.diffuse_color = colour
    mat.roughness = 0.32
    return mat


def ensure(size=512, seed=7, colour=None):
    """Our Innerds material if the file has one, else a new one. A material the user made by hand under the same
    name is never touched: ours then gets a different name."""
    for m in bpy.data.materials:
        if is_innerds(m):
            return m, False
    name = NAME if bpy.data.materials.get(NAME) is None else FALLBACK_NAME
    return build(size, seed, colour, name), True


def controls(mat):
    """The sockets a user edits: {'colour', 'wet', 'bump'} (missing ones are left out)."""
    out = {}
    if not is_innerds(mat) or mat.node_tree is None:
        return out
    nodes = mat.node_tree.nodes
    mix = nodes.get("Species Colour")
    if mix is not None:
        out['colour'] = _socket(mix, 'B_Color')
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is not None:
        wet = _principled(bsdf, "Coat Weight", "Clearcoat")
        if wet is not None:
            out['wet'] = wet
    nm = nodes.get("Bumpiness")
    if nm is not None:
        out['bump'] = nm.inputs['Strength']
    return out


def set_colour(mat, colour):
    c = controls(mat).get('colour')
    if c is not None:
        c.default_value = colour
        mat.diffuse_color = colour
