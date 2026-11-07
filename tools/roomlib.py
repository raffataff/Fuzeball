"""
roomlib.py  --  the PBR machinery the room builders share (build_arcade_room.py, build_moon_base.py; build_saucer_room.py still carries its own copy)

    surface sets   tiling albedo / normal / ORM for a kind of surface (steel, brass, paint, plastic, wood), worn by prop materials through
                   box-projected UVs. A neutral albedo is multiplied by the material's colour; paint and wood carry their own (paint_albedo,
                   wood_albedo). ORM green is absolute roughness for the roughest wearer: the others scale it with glTF factors (glb_factors).
    bake_light     ambient occlusion + the room's own lamps, ray-traced per corner into the baked colour (glTF COLOR_0)
    glb_factors    writes roughness / metallic factors into a GLB's JSON (Blender's exporter writes none when a texture drives the input)

numpy only at import (bake_light imports mathutils), so the sets can be previewed outside a build. Image arrays: row 0 = top, sRGB 0..1.
"""
import math, time
import numpy as np

def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def hx(h): return np.array([((h >> s) & 255) / 255 for s in (16, 8, 0)])
def lin(h): return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in hx(h)])
def lin2srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-6), 1 / 2.4) - 0.055)

# ---- tileable noise, strokes, blur, normals -----------------------------------------------------
def tn(H, W, py, px, seed):
    g = np.random.default_rng(seed).random((py, px))
    ys = np.arange(H) / H * py; xs = np.arange(W) / W * px
    y0 = ys.astype(int); x0 = xs.astype(int); fy = ys - y0; fx = xs - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx); y1 = (y0 + 1) % py; x1 = (x0 + 1) % px
    a = g[y0][:, x0] * (1 - fx)[None] + g[y0][:, x1] * fx[None]
    b = g[y1][:, x0] * (1 - fx)[None] + g[y1][:, x1] * fx[None]
    return a * (1 - fy)[:, None] + b * fy[:, None]
def tfbm(H, W, py, px, seed, octs=4, gain=0.5):
    out = np.zeros((H, W)); amp = 1.0; tot = 0.0
    for o in range(octs):
        out += amp * tn(H, W, py * 2 ** o, px * 2 ** o, seed + o * 31); tot += amp; amp *= gain
    return out / tot
def seg_aa(img, p0, p1, w, val=1.0):
    h, wd = img.shape; x0, y0 = p0; x1, y1 = p1; pad = w + 2
    xa, xb = int(max(0, min(x0, x1) - pad)), int(min(wd, max(x0, x1) + pad + 1))
    ya, yb = int(max(0, min(y0, y1) - pad)), int(min(h, max(y0, y1) + pad + 1))
    if xb <= xa or yb <= ya: return
    X, Y = np.meshgrid(np.arange(xa, xb) + 0.5, np.arange(ya, yb) + 0.5)
    dx, dy = x1 - x0, y1 - y0; L2 = dx * dx + dy * dy + 1e-9
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    d = np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy))
    img[ya:yb, xa:xb] = np.maximum(img[ya:yb, xa:xb], np.clip(w * 0.5 + 0.5 - d, 0, 1) * val)
def seg_wrap(img, p0, p1, w, val):
    H, W = img.shape
    for ox in (-W, 0, W):
        for oy in (-H, 0, H):
            if min(p0[0], p1[0]) + ox > W + 4 or max(p0[0], p1[0]) + ox < -4 or min(p0[1], p1[1]) + oy > H + 4 or max(p0[1], p1[1]) + oy < -4: continue
            seg_aa(img, (p0[0] + ox, p0[1] + oy), (p1[0] + ox, p1[1] + oy), w, val)
def gblur(a, s, wrap=True):
    pad = 0 if wrap else int(s * 3.5) + 1
    if pad: a = np.pad(a, ((pad, pad), (pad, pad)))
    fy = np.fft.fftfreq(a.shape[0])[:, None]; fx = np.fft.rfftfreq(a.shape[1])[None, :]
    r = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * (math.pi * s) ** 2 * (fx * fx + fy * fy)), s=a.shape)
    return r[pad:-pad, pad:-pad] if pad else r
def height_to_normal(Hf, px_x, px_y, k=1.0, wrap_x=False, wrap_y=False):
    """Tangent-space normal of a height field (px_* = units a pixel); wrap_x / wrap_y take periodic differences so a tiling map's edges meet."""
    gy, gx = np.gradient(Hf, px_y, px_x)
    if wrap_x: gx = (np.roll(Hf, -1, 1) - np.roll(Hf, 1, 1)) / (2 * px_x)
    if wrap_y: gy = (np.roll(Hf, -1, 0) - np.roll(Hf, 1, 0)) / (2 * px_y)
    n = np.stack([-gx * k, gy * k, np.ones_like(Hf)], -1)           # rows go DOWN the image, hence +gy
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5
def worley(N, cells, seed):
    """Periodic F1, F2 (in cell widths) to one jittered point per cell; cells x cells over the tile."""
    g = np.random.default_rng(seed).random((cells, cells, 2))
    c = (np.arange(N) + .5) / N * cells; X, Y = np.meshgrid(c, c)
    ix, iy = np.floor(X).astype(int), np.floor(Y).astype(int)
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy; p = g[cy % cells, cx % cells]
            d = np.hypot(cx + p[..., 0] - X, cy + p[..., 1] - Y)
            f2 = np.where(d < f1, f1, np.minimum(f2, d)); f1 = np.minimum(f1, d)
    return f1, f2
def hairlines(N, seed):
    """Fine parallel lines along x (a brushed or turned finish), fading in and out."""
    rows = tfbm(N, 1, N // 2, 1, seed, 3, 0.6)[:, 0]
    return (rows[:, None] - 0.5) * (0.5 + tfbm(N, N, 4, 10, seed + 1, 3)) + 0.5
def scratches(N, n, lmin, lmax, seed, ang=None, spread=0.25):
    """Wrapping hairline scratches, lengths in pixels; ang None = any direction, else around ang (radians)."""
    g = np.random.default_rng(seed); s = np.zeros((N, N))
    for _ in range(n):
        x, y = g.uniform(0, N), g.uniform(0, N); l = g.uniform(lmin, lmax)
        a = g.uniform(0, math.pi) if ang is None else ang + g.normal(0, spread)
        seg_wrap(s, (x, y), (x + l * math.cos(a), y + l * math.sin(a)), g.uniform(0.6, 1.3), g.uniform(0.3, 1.0))
    return s

# =============================================================================================
# SURFACE SETS (N = pixels a side, a power of two; seed = the room's seed)
# =============================================================================================
SURF_TILE = {'steel': 22.0, 'brass': 30.0, 'paint': 56.0, 'leather': 14.0, 'wood': 64.0, 'plastic': 20.0}   # cm one repeat covers
SURF_K    = {'steel': 0.9, 'brass': 1.1, 'paint': 1.3, 'leather': 1.6, 'wood': 1.2, 'plastic': 0.7}         # normal strength
def surf_nrm(H, N, k): return height_to_normal(H, 512.0 / N, 512.0 / N, k, True, True)
def surf_orm(rough, metal): return np.stack([np.ones_like(rough), np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)], -1)
def neutral(alb_lin):
    """Neutral albedo in linear light -> (sRGB image, mean) for a material that multiplies it by its colour."""
    return lin2srgb(alb_lin), float(alb_lin.mean())

def steel_set(N, seed):
    """Brushed / turned steel: hairlines, smudges and prints that dull it, grime in patches, a few bright scratches. -> albedo, mean, normal, ORM"""
    s = N / 512.0
    br = hairlines(N, seed + 101)
    smudge = sstep(0.52, 0.8, tfbm(N, N, 4, 4, seed + 103, 5))
    prints = sstep(0.6, 0.78, tfbm(N, N, 16, 16, seed + 104, 3)) * sstep(0.45, 0.7, tfbm(N, N, 2, 2, seed + 105, 3))
    grime = sstep(0.64, 0.9, tfbm(N, N, 7, 7, seed + 106, 5))
    scr = scratches(N, int(150 * s), 12 * s, 110 * s, seed + 107)
    lum = 0.93 - 0.03 * smudge - 0.15 * grime + 0.05 * (br - 0.5) + 0.04 * scr
    alb = np.stack([lum, lum * (1 - 0.04 * grime), lum * (1 - 0.1 * grime)], -1)
    rough = 0.16 + 0.12 * (br - 0.5) + 0.14 * smudge + 0.12 * prints + 0.2 * grime - 0.07 * scr
    metal = 1.0 - 0.3 * grime
    H = 0.6 * (br - 0.5) - 0.7 * scr + 0.15 * (tfbm(N, N, 6, 6, seed + 108, 3) - 0.5)
    a, m = neutral(alb)
    return a, m, surf_nrm(H, N, SURF_K['steel']), surf_orm(rough, metal)

def brass_set(N, seed):
    """Turned brass: polished where hands go, tarnished and pitted where they do not, softly hammered. -> albedo, mean, normal, ORM"""
    s = N / 512.0
    tarn = sstep(0.4, 0.72, tfbm(N, N, 4, 4, seed + 111, 5)) * (1 - 0.85 * sstep(0.45, 0.72, tfbm(N, N, 2, 2, seed + 112, 4)))
    f1, _ = worley(N, max(8, N // 9), seed + 113)
    pit = (1 - sstep(0.0, 0.16, f1)) * (tfbm(N, N, 57, 57, seed + 114, 2) > 0.62) * (0.4 + 0.6 * tarn)
    pol = hairlines(N, seed + 115)
    scr = scratches(N, int(90 * s), 8 * s, 70 * s, seed + 116)
    lum = 0.96 - 0.26 * tarn - 0.45 * pit + 0.05 * scr
    alb = np.stack([lum, lum * (1 - 0.06 * tarn), lum * (1 - 0.15 * tarn)], -1)
    rough = 0.14 + 0.28 * tarn + 0.06 * (pol - 0.5) + 0.3 * pit - 0.06 * scr + 0.05 * (tfbm(N, N, 24, 24, seed + 117, 3) - 0.5)
    metal = 1.0 - 0.25 * tarn - 0.6 * pit
    H = 1.6 * (tfbm(N, N, 5, 5, seed + 118, 3) - 0.5) + 0.25 * (pol - 0.5) - 0.8 * pit - 0.5 * scr
    a, m = neutral(alb)
    return a, m, surf_nrm(H, N, SURF_K['brass']), surf_orm(rough, metal)

def paint_set(N, seed):
    """Enamel on steel, shared by every painted material: orange peel, chips down to the steel with a primer rim, scuffs, grime and runs.
    -> normal, ORM, the masks paint_albedo colours"""
    s = N / 512.0
    cl = sstep(0.38, 0.78, tfbm(N, N, 3, 3, seed + 121, 4))
    sc = tfbm(N, N, 26, 26, seed + 122, 5) + 0.10 * (tfbm(N, N, 96, 96, seed + 123, 2) - 0.5) + 0.22 * cl - 0.915
    chip = sstep(0.0, 0.01, sc); rim = sstep(-0.016, 0.0, sc) * (1 - chip)
    peel = tfbm(N, N, 72, 72, seed + 124, 2); mott = tfbm(N, N, 8, 8, seed + 125, 4)
    grime = sstep(0.52, 0.86, tfbm(N, N, 4, 4, seed + 126, 5))
    runs = sstep(0.6, 0.9, tfbm(N, N, 2, 28, seed + 127, 4, 0.6)) * (0.35 + 0.65 * grime)
    scuff = scratches(N, int(130 * s), 6 * s, 45 * s, seed + 128)
    rust = sstep(0.62, 0.85, tfbm(N, N, 20, 20, seed + 129, 3)) * chip
    rough = 0.30 + 0.07 * (mott - 0.5) + 0.05 * (peel - 0.5) + 0.26 * grime + 0.14 * runs + 0.22 * scuff
    rough = rough * (1 - chip - rim) + chip * (0.36 + 0.4 * rust) + rim * 0.78
    metal = chip * (1 - 0.8 * rust)
    H = 1.0 * (1 - chip) - 0.4 * rim + 0.35 * (peel - 0.5) - 0.3 * scuff
    M = dict(chip=chip, rim=rim, mott=mott, grime=grime, runs=runs, scuff=scuff, rust=rust)
    return surf_nrm(H, N, SURF_K['paint']), surf_orm(rough, metal), M
def paint_albedo(M, hexc):
    base = hx(hexc)[None, None] * (0.93 + 0.14 * M['mott'])[..., None]
    base = base + (np.minimum(1, hx(hexc) * 1.35 + 0.08) - base) * (0.55 * M['scuff'])[..., None]
    base = base * (1 - 0.34 * M['grime'] - 0.22 * M['runs'])[..., None] * np.array([1.0, 0.98, 0.95])[None, None] ** M['grime'][..., None]
    steel = np.array([0.56, 0.58, 0.6])[None, None] * (0.85 + 0.3 * M['mott'])[..., None]
    steel = steel * (1 - M['rust'][..., None]) + hx(0x6d3a1c) * M['rust'][..., None]
    ch, rm = M['chip'][..., None], M['rim'][..., None]
    return np.clip(base * (1 - ch - rm) + rm * hx(0x5e5048) + ch * steel, 0, 1)

def plastic_set(N, seed):
    """Moulded plastic, rubber, cork, paper: a fine grain, dust settled in patches, worn smooth spots, scuffs. -> albedo, mean, normal, ORM"""
    s = N / 512.0
    grain = tfbm(N, N, 110, 110, seed + 151, 2)
    dust = sstep(0.5, 0.86, tfbm(N, N, 4, 4, seed + 152, 5))
    worn = sstep(0.55, 0.8, tfbm(N, N, 3, 3, seed + 153, 4))
    scr = scratches(N, int(70 * s), 6 * s, 40 * s, seed + 154)
    lum = 0.78 + 0.05 * (grain - 0.5) + 0.2 * dust - 0.05 * worn + 0.12 * scr
    rough = 0.84 + 0.06 * (grain - 0.5) + 0.14 * dust - 0.2 * worn - 0.12 * scr
    H = 0.4 * (grain - 0.5) - 0.6 * scr
    a, m = neutral(np.stack([lum, lum, lum], -1))
    return a, m, surf_nrm(H, N, SURF_K['plastic']), surf_orm(rough, 0 * rough)

def wood_set(N, seed, raw=False):
    """Planks along x, each cut off its own log (growth rings arch where the board leaves the log's axis), pores and fibre along the grain,
    seams, end joints, dents, scratches. Lacquered (a counter: worn dull where used) or raw (crates, pallets: saw marks across the grain,
    no gloss, handled patches polished). -> normal, ORM, the masks wood_albedo colours"""
    s = N / 512.0; NP = 6; T = SURF_TILE['wood']; W = T / NP
    yy, xx = np.mgrid[0:N, 0:N]; u = (xx + .5) / N; v = (yy + .5) / N
    pk = np.floor(v * NP).astype(int); pv = v * NP - pk
    g = np.random.default_rng(seed + 141)
    D0, A, K, ph, cx = g.uniform(9, 22, NP), g.uniform(1.0, 3.0, NP), g.integers(1, 3, NP), g.uniform(0, 2 * math.pi, NP), g.uniform(-0.9, 0.9, NP)
    tint, joint, hue = 0.88 + 0.22 * g.random(NP), g.random(NP), g.random(NP)
    depth = D0[pk] + A[pk] * np.sin(2 * math.pi * u * K[pk] + ph[pk]) + 0.8 * (tfbm(N, N, 2, 3, seed + 142, 3) - 0.5)
    rad = np.hypot((pv - 0.5 + cx[pk]) * W, depth) + 0.25 * (tfbm(N, N, 6, 4, seed + 143, 3) - 0.5)
    f = (rad * 3.2 + 1.5 * tfbm(N, N, 3, 2, seed + 151, 3)) % 1.0     # ~3 rings a cm, their widths wandering
    late = (sstep(0.55, 0.88, f) * (1 - sstep(0.92, 1.0, f))) * (0.55 + 0.45 * tfbm(N, N, 4, 2, seed + 152, 3))
    fibre = tfbm(N, N, int(260 * s), 5, seed + 144, 2)
    pores = sstep(0.74, 0.92, tfbm(N, N, int(200 * s), 36, seed + 145, 2)) * (0.4 + 0.6 * (1 - late))
    figure = tfbm(N, N, 3, 2, seed + 150, 4)
    dseam = np.minimum(pv, 1 - pv) * N / NP
    seam = np.exp(-(dseam / (1.1 * s)) ** 2)
    dj = np.abs(((u - joint[pk] + 0.5) % 1.0) - 0.5) * N
    jt = np.exp(-(dj / (1.0 * s)) ** 2) * (pv > 0.02) * (pv < 0.98)
    wear = sstep(0.5, 0.8, tfbm(N, N, 3, 3, seed + 146, 5))
    f1, _ = worley(N, max(6, N // 40), seed + 147); dent = (1 - sstep(0.0, 0.22, f1)) * (tfbm(N, N, 13, 13, seed + 148, 2) > 0.62)
    scr = scratches(N, int(110 * s), 10 * s, 90 * s, seed + 149, 0.0, 0.35)
    if raw:
        saw = tfbm(N, N, 3, int(110 * s), seed + 155, 2)                  # rough-sawn: faint bands across the grain
        rough = 0.66 + 0.06 * late + 0.08 * (fibre - 0.5) + 0.08 * pores + 0.2 * np.maximum(seam, jt) - 0.22 * wear + 0.08 * scr + 0.06 * (saw - 0.5)
        H = -1.0 * seam - 0.9 * jt + 0.15 * late - 0.2 * pores + 0.3 * (fibre - 0.5) + 0.35 * (saw - 0.5) - 0.6 * dent - 0.3 * scr
    else:
        rough = 0.2 + 0.05 * late + 0.05 * (fibre - 0.5) + 0.3 * wear + 0.12 * pores + 0.45 * np.maximum(seam, jt) + 0.15 * scr
        H = -1.0 * seam - 0.9 * jt + 0.1 * late - 0.25 * pores + 0.08 * (fibre - 0.5) - 0.6 * dent - 0.3 * scr
    M = dict(pk=pk, late=late, fibre=fibre, pores=pores, figure=figure, seam=seam, jt=jt, wear=wear, scr=scr, tint=tint, hue=hue, raw=raw)
    return surf_nrm(H, N, SURF_K['wood']), surf_orm(rough, 0 * rough), M
def wood_albedo(M, light, dark):
    pk = M['pk']; light, dark = hx(light), hx(dark)
    alb = light[None, None] + (dark - light)[None, None] * np.clip(0.42 * M['late'] + 0.25 * M['fibre'] + 0.25 * M['pores'] + 0.35 * (M['figure'] - 0.5) + 0.12, 0, 1)[..., None]
    alb = alb * M['tint'][pk][..., None] * (1 + 0.08 * (M['hue'][pk] - 0.5)[..., None] * np.array([1.0, 0.2, -0.8]))
    worn = (1 - 0.14 * M['wear']) if M['raw'] else (1 + 0.12 * M['wear'])            # raw wood darkens where handled, lacquer pales where worn
    alb = alb * worn[..., None] * (1 - 0.5 * M['seam'] - 0.4 * M['jt'])[..., None] + 0.05 * M['scr'][..., None]
    return np.clip(alb, 0, 1)

# =============================================================================================
# GLB FACTORS, THE LIGHT BAKE
# =============================================================================================
def glb_factors(path, fact):
    """Write each listed material's roughness / metallic factor into the GLB's JSON (the exporter writes none when a texture drives the input)."""
    import json, struct
    b = open(path, 'rb').read(); jl = struct.unpack_from('<I', b, 12)[0]; j = json.loads(b[20:20 + jl])
    for mt in j.get('materials', []):
        f = fact.get(mt.get('name'))
        if f:
            pb = mt.setdefault('pbrMetallicRoughness', {}); pb['roughnessFactor'] = round(float(f[0]), 4); pb['metallicFactor'] = round(float(f[1]), 4)
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4); rest = b[20 + jl:]
    open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 20 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)

def lamp_tint(hexc, white=0.45): return white + (1 - white) * lin(hexc)     # a lamp's tint in the bake: its glow colour pulled toward white

def bake_light(occ, targets, lamps, rays=24, reach=26.0, ao=0.7, amb=0.46, soft=14.0, seed=0, ao_k=None, tag='room'):
    """occ: objects that block rays; targets: objects whose corner colour 'Col' (made if missing) is multiplied by the bake.
    lamps: (point in the objects' space, linear rgb tint, strength = brightness x cm^2 at the lamp). Per corner, `rays` cosine rays within
    `reach` give the occlusion (x ao, x ao_k[object name]); each visible lamp adds strength x cos / (d^2 + soft^2) to amb; the sum is
    scaled by its brightest channel, not clipped (clipping at 1 turned every pool white)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    t0 = time.time(); ao_k = ao_k or {}
    V, P = [], []
    for o in occ:
        k = len(V); V.extend(o.matrix_world @ v.co for v in o.data.vertices); P.extend(tuple(k + i for i in p.vertices) for p in o.data.polygons)
    bvh = BVHTree.FromPolygons(V, P, epsilon=0.0)
    g = np.random.default_rng(seed + 171); n_ = rays
    u1 = (np.arange(n_) + g.random(n_)) / n_; u2 = g.random(n_)                                   # cosine-weighted hemisphere, stratified
    hemi = np.stack([np.sqrt(u1) * np.cos(2 * math.pi * u2), np.sqrt(u1) * np.sin(2 * math.pi * u2), np.sqrt(1 - u1)], -1)
    lamps = [(Vector(p), np.asarray(c, float), s) for p, c, s in lamps]
    def cast(org, d, dist):
        """The first FRONT face along the ray: a corner buried in another piece (a board in its frame) would otherwise see only the inside."""
        for _ in range(4):
            hit = bvh.ray_cast(org, d, dist)
            if hit[0] is None or hit[1].dot(d) < 0: return hit
            step = hit[3] + 0.02; org = org + d * step; dist -= step
            if dist <= 0: break
        return (None, None, None, None)
    SOFT = soft * soft; cache = {}; done = 0
    for o in targets:
        me = o.data; A0 = ao * ao_k.get(o.name, 1.0)
        if not me.color_attributes.get('Col'):
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); ca.data.foreach_set('color', np.ones(len(me.loops) * 4, np.float32))
        ca = me.color_attributes['Col']
        if ca.domain != 'CORNER': continue
        cols = np.zeros(len(me.loops) * 4, np.float32); ca.data.foreach_get('color', cols); cols = cols.reshape(-1, 4)
        cn = np.zeros(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
        vi = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
        Mw = o.matrix_world; R3 = Mw.to_3x3()
        for li in range(len(me.loops)):
            p = Mw @ me.vertices[vi[li]].co; n = (R3 @ Vector(cn[li])).normalized()
            key = (round(p.x, 2), round(p.y, 2), round(p.z, 2), round(n.x, 1), round(n.y, 1), round(n.z, 1), A0)
            f = cache.get(key)
            if f is None:
                t = n.orthogonal().normalized(); b = n.cross(t); org = p + n * 0.06; occl = 0.0
                for hx_, hy_, hz_ in hemi:
                    hit = cast(org, t * hx_ + b * hy_ + n * hz_, reach)
                    if hit[0] is not None: occl += 1.0 - (org - hit[0]).length / reach
                a = 1.0 - A0 * occl / n_
                lit = np.full(3, amb)
                for lp, lc, ls in lamps:
                    d = lp - org; dl = d.length; cos = n.dot(d) / max(dl, 1e-6)
                    if cos <= 0.0 or ls / (dl * dl + SOFT) < 0.004: continue
                    hit = cast(org, d / dl, dl - 4.0)
                    if hit[0] is None: lit = lit + lc * (ls * cos / (dl * dl + SOFT))
                f = cache[key] = a * lit / max(1.0, float(lit.max()))
            cols[li, :3] *= f
        ca.data.foreach_set('color', cols.ravel()); done += len(me.loops)
    print('%s: light bake %d corners, %d unique, %.1fs' % (tag, done, len(cache), time.time() - t0))
