"""
build_nebula_sky.py  --  Fuzeball VOID room sky -> six cube faces (PNG masters)

Run headless from the project root:

    blender -b -P tools/build_nebula_sky.py -- [--res 2048] [--verify] [--preview] [--seed 7]

then encode the masters for the game:

    node tools/sky-encode.mjs tools/build/sky/void assets/rooms/void/sky/nebula

WHAT IT MAKES
    tools/build/sky/void/nebula_{px,nx,py,ny,pz,nz}.png   8-bit sRGB masters, --res square
    tools/build/sky/void/nebula_cross.png                 (--preview) a small cross for eyeballing

HOW  (the shared cube/star/tone machinery is tools/skylib.py)
    1. The GAS is a world shader (layered noise in the Federation palette), rendered by EEVEE through
       six 90-degree cameras, straight to float EXR. No geometry, so it is a few seconds per face.
    2. The STARS are splatted afterwards in numpy, at the final resolution, so they stay crisp points
       instead of being resampled blobs. Denser along the gas band, like a galactic plane.
    3. The result is pre-compensated for the game's tone mapping (CONFIG.render: reinhard x1.08, which
       r128 also runs on scene.background), dithered, and written as 8-bit PNG.

THE CUBE CONVENTION IS THREE.JS r128's, NOT BLENDER'S. Faces are written so that
`new THREE.CubeTexture(faces)` (which samples with x flipped, `_needsFlipEnvMap`) shows the sky the
right way round, with game axes: X = long axis, Y = up, Z = width. The face bases below are the
OpenGL cube-map spec with image row 0 at the top (three uploads cube faces with flipY=false).
--verify renders a direction-coloured world instead and checks every face against the analytic
directions the stars use, so the two halves can never disagree.

PALETTE (DIRECTION.md section 3): deep space #07111C, Federation blue #123F5E, steel #6BAABC,
ice #BCDCED, copper #B8621F, gold #F0B24A (small, hot cores only). Deliberately NOT magenta/cyan.
"""
import bpy, os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skylib as K

# ---- args --------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None, flag=False):
    if name not in argv: return default
    if flag: return True
    return argv[argv.index(name) + 1]
RES     = int(arg('--res', 2048))
VERIFY  = arg('--verify', flag=True)
PREVIEW = arg('--preview', flag=True)
SEED    = int(arg('--seed', 7))
SAMPLES = int(arg('--samples', 16))

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT  = os.path.join(ROOT, 'tools', 'build', 'sky', 'void')   # masters stay out of assets/ (gitignored, never shipped)

# ---- the look (tune here) ----------------------------------------------------------------------
BAND_TILT_DEG    = 24            # how far the gas band leans off the horizon (game up = Blender Z)
BAND_YAW_DEG     = 35
BAND_WIDTH       = 0.30          # in dot(dir, bandNormal) units, ~17 degrees
GAS_GAIN         = 1.15          # overall nebula brightness (display-referred, pre tone map)
STARS            = 16000         # at 2048; scaled with the face area
STAR_BAND_BIAS   = 0.55          # fraction of stars drawn from the band rather than uniformly

sky = K.Sky(RES, SAMPLES, OUT)
if VERIFY: sys.exit(0 if sky.verify() else 1)

node, link, math_, vmath, noise, ramp, mix = sky.node, sky.link, sky.math, sky.vmath, sky.noise, sky.ramp, sky.mix
D, bg = sky.D, sky.bg
rng = np.random.default_rng(SEED)
off = [tuple(rng.uniform(-50, 50, 3)) for _ in range(6)]
tilt, yaw = math.radians(BAND_TILT_DEG), math.radians(BAND_YAW_DEG)
bn = (math.sin(tilt) * math.cos(yaw), math.sin(tilt) * math.sin(yaw), math.cos(tilt))

# domain warp: the whole gas field is pushed around by a slow noise, so no layer reads as "noise"
Dw0 = vmath('ADD', D, off[0])
warp = noise(Dw0, 1.1, 3, 0.5)
wv = vmath('SUBTRACT', warp.outputs['Color'], (0.5, 0.5, 0.5))
Dw = vmath('ADD', D, vmath('SCALE', wv, scale=0.55))

# band: a wobbling great circle, not a stripe
edge = noise(vmath('ADD', D, off[1]), 2.4, 4, 0.55)
x = math_('ADD', vmath('DOT_PRODUCT', Dw, bn), math_('MULTIPLY', math_('SUBTRACT', edge.outputs['Fac'], 0.5), 0.34))
band = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, BAND_WIDTH), 2.0), -1.0))
halo = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, BAND_WIDTH * 2.6), 2.0), -1.0))

# gas body + fine filaments
gas  = noise(vmath('ADD', Dw, off[2]), 2.6, 9, 0.6, distort=0.25)
fil  = noise(vmath('ADD', Dw, off[3]), 5.5, 7, 0.55, ntype='RIDGED_MULTIFRACTAL', lac=2.2)
gasf = math_('POWER', gas.outputs['Fac'], 1.9)
filf = math_('POWER', fil.outputs['Fac'], 3.0)
dens = math_('ADD', math_('MULTIPLY', gasf, band), math_('MULTIPLY', math_('MULTIPLY', filf, 0.55), halo))
dens = math_('ADD', dens, math_('MULTIPLY', math_('POWER', gas.outputs['Fac'], 3.0), math_('MULTIPLY', halo, 0.18)))

# dust lanes: dark, ridged, only in the band's core
dust = noise(vmath('ADD', Dw, off[4]), 7.0, 6, 0.6, ntype='RIDGED_MULTIFRACTAL', lac=2.3)
dustm = math_('MULTIPLY', math_('POWER', dust.outputs['Fac'], 4.0), band)
keep = math_('SUBTRACT', 1.0, math_('MULTIPLY', dustm, 0.9), clamp=True)

# colour: cool steel body, a copper region where a slow noise says so, gold only in hot cores
cool = ramp(dens, [(0.0, 0x03070c), (0.18, 0x0b2438), (0.45, 0x1f5873), (0.8, 0x6baabc), (1.0, 0xbcdced)])
warm = ramp(dens, [(0.0, 0x05050a), (0.2, 0x2a1208), (0.5, 0x8a4516), (0.85, 0xd08a3a), (1.0, 0xf6ddb0)])
region = noise(vmath('ADD', D, off[5]), 0.9, 2, 0.5)
wm = node('ShaderNodeMapRange'); link(region.outputs['Fac'], wm.inputs['Value'])
wm.inputs['From Min'].default_value = 0.52; wm.inputs['From Max'].default_value = 0.68
col = mix(wm.outputs['Result'], cool, warm)
col = mix(keep, (0, 0, 0, 1), col)
link(col, bg.inputs['Color'])
bg.inputs['Strength'].default_value = GAS_GAIN

# ---- render, stars, write ----------------------------------------------------------------------
rng = np.random.default_rng(SEED + 1)
bn_game = K.bl_to_game(np.array(bn)[None])[0]
stars = K.star_list(rng, int(STARS * (RES / 2048) ** 2), bn_game, BAND_WIDTH, STAR_BAND_BIAS)
done = {}
for f in K.FACES:
    lin = sky.render_face(f)
    K.splat_stars(lin, f, stars, RES)
    a8 = K.to_srgb8(lin, rng)
    K.save_png(a8, os.path.join(OUT, 'nebula_%s.png' % f))
    done[f] = a8
    print('sky: wrote nebula_%s.png' % f)
if PREVIEW:
    K.save_png(K.cross(done, RES), os.path.join(OUT, 'nebula_cross.png'))
    print('sky: wrote nebula_cross.png')
sky.cleanup()
print('sky: done')
