"""
skylib.py  --  shared machinery for Fuzeball's room skies (imported by the build_*_sky.py scripts;
runs inside Blender, needs bpy + numpy).

A room sky is six cube faces for `new THREE.CubeTexture(faces)` (models.js ensureSky). This module
owns the parts every sky shares, so a sky script only describes its look:

    Sky(res, samples, out_dir)    an empty scene, a 90-degree camera, a world node tree + node helpers
    sky.render_face(face)         one face, float, row 0 = top, already in three.js's layout
    sky.verify()                  renders a direction-coloured world and checks every face against
                                  face_dirs() -- the analytic directions stars/suns are placed with
    star_list / splat_stars       crisp point stars at the final resolution
    to_srgb8                      pre-compensates the game's tone mapping (r128 runs it on
                                  scene.background too), dithers, quantises
    save_png / cross              masters + an eyeballing cross

THE CUBE CONVENTION IS THREE.JS r128's. Faces are the OpenGL cube-map spec with image row 0 at the
top (three uploads cube faces with flipY=false), sampled with x flipped (CubeTexture's
_needsFlipEnvMap). Game axes: X = long axis, Y = up, Z = width. Blender is Z-up: game (x,y,z) =
Blender (x,-z... see game_to_bl). Some faces come out mirrored through a real camera; render_face
renders those with the right axis negated and flips them back.
"""
import bpy, os, math
import numpy as np
from mathutils import Matrix

def hexlin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

# GL direction for pixel (u right, v down, both -1..1): center + u*right + v*down
FACES = {
    'px': ((1, 0, 0), (0, 0, -1), (0, -1, 0)),
    'nx': ((-1, 0, 0), (0, 0, 1), (0, -1, 0)),
    'py': ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    'ny': ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
    'pz': ((0, 0, 1), (1, 0, 0), (0, -1, 0)),
    'nz': ((0, 0, -1), (-1, 0, 0), (0, -1, 0)),
}
def gl_to_game(g):   return np.stack([-g[..., 0], g[..., 1], g[..., 2]], -1)        # three's flipEnvMap
def game_to_bl(w):   return np.stack([w[..., 0], -w[..., 2], w[..., 1]], -1)        # glTF: game Y up = Blender Z
def bl_to_game(b):   return np.stack([b[..., 0], b[..., 2], -b[..., 1]], -1)
def game_to_gl(w):   return np.stack([-w[..., 0], w[..., 1], w[..., 2]], -1)
def unit(v):         v = np.asarray(v, float); return v / np.linalg.norm(v)

def face_dirs(face, n):
    """Unit GAME-space direction of every pixel centre, row 0 = top. Shape (n, n, 3)."""
    c, r, d = (np.array(x, float) for x in FACES[face])
    t = (np.arange(n) + 0.5) / n * 2 - 1
    u, v = np.meshgrid(t, t)
    g = c + u[..., None] * r + v[..., None] * d
    w = gl_to_game(g)
    return w / np.linalg.norm(w, axis=-1, keepdims=True)

class Sky:
    def __init__(self, res, samples, out_dir, transparent=False, clip_end=10.0):
        self.res = res; self.out = out_dir; self.tmp = os.path.join(out_dir, '_tmp')
        os.makedirs(self.tmp, exist_ok=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = self.scene = bpy.context.scene
        for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
            try: sc.render.engine = eng; break
            except TypeError: pass
        print('sky: render engine', sc.render.engine)
        if sc.render.engine.startswith('BLENDER_EEVEE'): sc.eevee.taa_render_samples = samples
        else: sc.cycles.samples = samples
        sc.render.resolution_x = sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        sc.render.film_transparent = transparent
        sc.view_settings.view_transform = 'Standard'
        sc.render.image_settings.file_format = 'OPEN_EXR'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '32'
        cd = bpy.data.cameras.new('skycam')
        cd.type = 'PERSP'; cd.sensor_fit = 'HORIZONTAL'; cd.angle = math.pi / 2
        cd.clip_start = 0.01; cd.clip_end = clip_end
        self.cam = bpy.data.objects.new('skycam', cd)
        sc.collection.objects.link(self.cam); sc.camera = self.cam
        w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
        self.nt = w.node_tree
        for x in list(self.nt.nodes): self.nt.nodes.remove(x)
        self.tc = self.node('ShaderNodeTexCoord')
        self.bg = self.node('ShaderNodeBackground')
        out = self.node('ShaderNodeOutputWorld')
        self.link(self.bg.outputs[0], out.inputs['Surface'])
        self.D = self.vmath('NORMALIZE', self.tc.outputs['Generated'])   # view direction, Blender space

    # ---- node helpers (world tree) ----
    def node(self, t, **kw):
        n = self.nt.nodes.new(t)
        for k, v in kw.items():
            if k.startswith('in_'): n.inputs[k[3:].replace('_', ' ')].default_value = v
            else: setattr(n, k, v)
        return n
    def link(self, a, b): self.nt.links.new(a, b)
    def math(self, op, a=None, b=None, clamp=False):
        m = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None: continue
            if isinstance(x, (int, float)): m.inputs[i].default_value = x
            else: self.link(x, m.inputs[i])
        return m.outputs[0]
    def vmath(self, op, a, b=None, scale=None):
        m = self.node('ShaderNodeVectorMath', operation=op)
        for i, x in enumerate((a, b)):
            if x is None: continue
            if isinstance(x, (tuple, list)): m.inputs[i].default_value = x
            else: self.link(x, m.inputs[i])
        if scale is not None: m.inputs['Scale'].default_value = scale
        return m.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else m.outputs['Vector']
    def noise(self, vec, scale, detail, rough, distort=0.0, ntype='FBM', lac=2.0):
        n = self.node('ShaderNodeTexNoise'); n.noise_dimensions = '3D'
        try: n.noise_type = ntype
        except Exception: pass
        n.normalize = True
        self.link(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough; n.inputs['Lacunarity'].default_value = lac
        n.inputs['Distortion'].default_value = distort
        return n
    def ramp(self, fac, stops):
        r = self.node('ShaderNodeValToRGB'); el = r.color_ramp.elements
        while len(el) > 2: el.remove(el[-1])
        for i, (p, h) in enumerate(stops):
            e = el[i] if i < 2 else el.new(p)
            e.position = p; e.color = hexlin(h) if isinstance(h, int) else h
        self.link(fac, r.inputs['Fac'])
        return r.outputs['Color']
    def mix(self, fac, a, b, blend='MIX'):
        m = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        if isinstance(fac, (int, float)): m.inputs['Factor'].default_value = fac
        else: self.link(fac, m.inputs['Factor'])
        for sock, x in (('A', a), ('B', b)):
            s = [i for i in m.inputs if i.name == sock and i.type == 'RGBA'][0]
            if isinstance(x, (tuple, list)): s.default_value = x
            else: self.link(x, s)
        return [o for o in m.outputs if o.type == 'RGBA'][0]

    # ---- render ----
    def render_face(self, face, alpha=False):
        """One face as float, row 0 = top, in the three.js layout. (res,res,3), or 4 with alpha."""
        c, r, d = (np.array(x, float) for x in FACES[face])
        F = game_to_bl(gl_to_game(c)); R = game_to_bl(gl_to_game(r)); U = -game_to_bl(gl_to_game(d))
        flip = np.linalg.det(np.stack([R, U, -F], 1)) < 0          # the x-flip makes some faces mirror images
        if flip: R = -R
        self.cam.matrix_world = Matrix([list(R), list(U), list(-F)]).transposed().to_4x4()
        path = os.path.join(self.tmp, face + '.exr')
        self.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path, check_existing=False)
        n = self.res
        a = np.empty(n * n * 4, np.float32); img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        a = a.reshape(n, n, 4)[::-1, :, :4 if alpha else 3]         # Blender stores bottom row first
        if flip: a = a[:, ::-1]
        return a

    def verify(self):
        """Direction-coloured world through the same cameras, against face_dirs(). Replaces the world."""
        for x in list(self.nt.nodes):
            if x not in (self.tc,) and x.bl_idname != 'ShaderNodeOutputWorld' and x != self.bg and x != self.D.node: self.nt.nodes.remove(x)
        mad = self.node('ShaderNodeVectorMath', operation='MULTIPLY_ADD')
        self.link(self.D, mad.inputs[0]); mad.inputs[1].default_value = (0.5, 0.5, 0.5); mad.inputs[2].default_value = (0.5, 0.5, 0.5)
        self.link(mad.outputs['Vector'], self.bg.inputs['Color']); self.bg.inputs['Strength'].default_value = 1.0
        for o in list(self.scene.objects):
            if o != self.cam: o.hide_render = True
        worst = 0
        for f in FACES:
            got = self.render_face(f) * 2 - 1
            got /= np.linalg.norm(got, axis=-1, keepdims=True)
            want = game_to_bl(face_dirs(f, self.res))
            err = np.degrees(np.arccos(np.clip((got * want).sum(-1), -1, 1)))
            print('sky verify %s: max %.3f deg, mean %.4f deg' % (f, err.max(), err.mean()))
            worst = max(worst, err.max())
        ok = worst < 1.0
        print('sky verify: %s (worst %.3f deg)' % ('PASS' if ok else 'FAIL', worst))
        return ok

    def cleanup(self):
        for f in os.listdir(self.tmp): os.remove(os.path.join(self.tmp, f))
        os.rmdir(self.tmp)

# ---- stars -------------------------------------------------------------------------------------
def star_list(rng, n, band_normal=None, band_width=0.3, band_bias=0.0, mag=(0.09, 0.05)):
    """n unit GAME directions with magnitudes and colours. band_normal (game space) concentrates
    band_bias of them near that great circle."""
    v = rng.normal(size=(n * 3, 3)); v /= np.linalg.norm(v, axis=1, keepdims=True)
    if band_normal is not None:
        inband = np.exp(-(v @ np.asarray(band_normal) / (band_width * 1.3)) ** 2)
        keep = rng.random(len(v)) < (1 - band_bias) + band_bias * inband
    else:
        keep = rng.random(len(v)) < 1.0
    v = v[keep][:n]
    m = np.clip(rng.pareto(2.0, len(v)) * mag[0] + mag[1], 0, 2.0)   # steep power law: a few bright, most dust
    temp = rng.random(len(v))                                         # 0 = warm gold-white, 1 = ice blue-white
    colw = np.array(hexlin(0xf6ddb0)[:3]); colc = np.array(hexlin(0xdcecff)[:3])
    return v, m, colw[None] * (1 - temp[:, None]) + colc[None] * temp[:, None]

def splat_stars(img, face, stars, res, mask=None):
    """Add stars to one face (row 0 = top). mask (res,res) in 0..1 hides them (e.g. behind a planet)."""
    v, m, col = stars
    c, r, d = (np.array(x, float) for x in FACES[face])
    g = game_to_gl(v)
    depth = g @ c
    sel = depth > 0.5
    g, m, col = g[sel], m[sel], col[sel]; depth = depth[sel]
    u = (g @ r) / depth; w = (g @ d) / depth
    px = (u + 1) / 2 * res - 0.5; py = (w + 1) / 2 * res - 0.5
    ok = (px > -3) & (px < res + 2) & (py > -3) & (py < res + 2)
    px, py, m, col = px[ok], py[ok], m[ok], col[ok]
    scale = res / 2048
    add = np.zeros_like(img[..., :3])
    for x0, y0, mm, cc in zip(px, py, m, col):
        sig = (0.55 + 0.9 * min(mm, 1.0)) * scale
        rad = int(math.ceil(sig * 3.2 + (4 * scale if mm > 0.6 else 0)))
        xs = np.arange(int(x0) - rad, int(x0) + rad + 2); ys = np.arange(int(y0) - rad, int(y0) + rad + 2)
        xs = xs[(xs >= 0) & (xs < res)]; ys = ys[(ys >= 0) & (ys < res)]
        if not len(xs) or not len(ys): continue
        dx = xs[None, :] - x0; dy = ys[:, None] - y0; r2 = dx * dx + dy * dy
        k = np.exp(-r2 / (2 * sig * sig)) * mm
        if mm > 0.6: k += np.exp(-np.sqrt(r2) / (2.2 * scale)) * (mm - 0.6) * 0.08   # soft glow, no spikes
        add[ys[:, None], xs[None, :]] += k[..., None] * cc[None, None, :]
    if mask is not None: add *= (1 - mask)[..., None]
    img[..., :3] += add

# ---- tone compensation + dither + write -------------------------------------------------------
def to_srgb8(lin, rng, exposure=1.08):
    """lin = the linear colour we want ON SCREEN. Undo reinhard*exposure (CONFIG.render) so the game shows it."""
    x = np.clip(lin, 0, 0.5)                                      # reinhard cannot show more than 0.5 of a stored 1.0
    stored = np.clip(x / (exposure * (1 - x)), 0, 1)
    s = np.where(stored <= 0.0031308, stored * 12.92, 1.055 * np.power(stored, 1 / 2.4) - 0.055)
    s = s * 255 + (rng.random(s.shape) - rng.random(s.shape))    # triangular dither, +-1 LSB
    return np.clip(np.round(s), 0, 255).astype(np.uint8)

def save_png(a8, path):
    h, w = a8.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = a8 / 255.0
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)

def cross(faces, res, n=256):
    """Horizontal cross (py above pz, ny below) for eyeballing only."""
    step = max(1, res // n)
    sm = {f: faces[f][::step, ::step][:n, :n] for f in faces}
    C = np.zeros((n * 3, n * 4, 3), np.uint8)
    place = {'py': (0, 1), 'nx': (1, 0), 'pz': (1, 1), 'px': (1, 2), 'nz': (1, 3), 'ny': (2, 1)}
    for f, (ry, rx) in place.items(): C[ry * n:(ry + 1) * n, rx * n:(rx + 1) * n] = sm[f]
    return C
