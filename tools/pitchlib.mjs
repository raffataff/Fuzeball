/* pitchlib.mjs  --  shared by the generated pitches (build_moon_pitch.mjs, build_deck_pitch.mjs)

   The pitch every GLB shares: 120 x 68, uv u = x, v = z, image top-left = (-60,-34), 2048 x 1160
   (17 px per unit). Noise, the markings (read off royal.jpeg, so a generated pitch lines up with the
   painted ones) and the writer, which copies pitch_royal.glb's box and node and swaps in our images,
   so the loader sees nothing new. Everything here is deterministic: a script is its own master. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export const sharp = require('sharp');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P = (...a) => path.join(ROOT, ...a);
export const L = 120, WD = 68, W = 2048, H = 1160, PPU = W / L;

// ---- helpers -----------------------------------------------------------------------------------
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, o)); };
export async function raw(file) { const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; }
export function samp(t, u, v, out) {  // bilinear, wrapping; u,v in tiles
  const x = ((u % 1) + 1) % 1 * t.w - 0.5, y = ((v % 1) + 1) % 1 * t.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const g = (xx, yy) => t.d[((((yy % t.h) + t.h) % t.h) * t.w + (((xx % t.w) + t.w) % t.w)) * 3 + c];
    out[c] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  }
  return out;
}

// ---- markings: distance (units) from a point to the nearest painted line -------------------------
const segX = (x, z, x0, x1, zz) => Math.hypot(x - clamp(x, x0, x1), z - zz);   // horizontal segment
const segZ = (x, z, xx, z0, z1) => Math.hypot(x - xx, z - clamp(z, z0, z1));   // vertical segment
export const INSET = 0.8;             // border line inset from the pitch edge
export function lineDist(x, z) {
  const X = L / 2 - INSET, Z = WD / 2 - INSET;
  let d = Math.min(segX(x, z, -X, X, -Z), segX(x, z, -X, X, Z), segZ(x, z, -X, -Z, Z), segZ(x, z, X, -Z, Z));
  d = Math.min(d, segZ(x, z, 0, -Z, Z));                             // halfway
  const r = Math.hypot(x, z); d = Math.min(d, Math.abs(r - 10.5));   // centre circle
  for (const s of [-1, 1]) {
    const gx = s * X, ax = Math.abs(x);
    const box = (dep, hw) => Math.min(segX(x, z, Math.min(gx, gx - s * dep), Math.max(gx, gx - s * dep), -hw),
      segX(x, z, Math.min(gx, gx - s * dep), Math.max(gx, gx - s * dep), hw), segZ(x, z, gx - s * dep, -hw, hw));
    d = Math.min(d, box(19.5, 21), box(8, 11));                      // penalty box, goal box
    const px = s * (X - 13.5), pr = Math.hypot(x - px, z);           // penalty arc, outside the box only
    if (ax < X - 19.5) d = Math.min(d, Math.abs(pr - 10.5));
    for (const zs of [-1, 1]) { const cr = Math.hypot(x - gx, z - zs * Z); if (cr < 6) d = Math.min(d, Math.abs(cr - 2.5)); }  // corner arcs
  }
  return d;
}
export function spot(x, z) {           // filled spots: centre, penalties
  const X = L / 2 - INSET;
  return Math.min(Math.hypot(x, z) - 0.8, Math.hypot(x - (X - 13.5), z) - 0.6, Math.hypot(x + (X - 13.5), z) - 0.6);
}

// ---- output ------------------------------------------------------------------------------------
/* A (albedo), N (normal, glTF/OpenGL), M (R unused, G roughness, B metal): W*H*3 byte buffers.
   Writes assets/pitches/pitch_<id>.glb (PNG textures; run ktx2-encode.mjs on it next) and the
   JPEG fallback assets/pitches/<id>.jpeg that CONFIG.pitches.<id>.tex points at. */
export async function writePitch(id, A, N, M, emissive) {
  const img = (b) => sharp(b, { raw: { width: W, height: H, channels: 3 } });
  const albPng = await img(A).png().toBuffer(), nrmPng = await img(N).png().toBuffer(), ormPng = await img(M).png().toBuffer();
  const OUT_GLB = P('assets/pitches/pitch_' + id + '.glb'), OUT_JPG = P('assets/pitches/' + id + '.jpeg');
  await img(A).jpeg({ quality: 88 }).toFile(OUT_JPG);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(P('assets/pitches/pitch_royal.glb'));
  const root = doc.getRoot(), mat = root.listMaterials()[0];
  for (const t of root.listTextures()) t.dispose();
  const tex = (name, buf) => doc.createTexture(name).setImage(new Uint8Array(buf)).setMimeType('image/png');
  const tA = tex(id + '_pitch', albPng);
  mat.setName('field.' + id).setBaseColorTexture(tA).setEmissiveTexture(tA).setEmissiveFactor([emissive, emissive, emissive])
    .setNormalTexture(tex(id + '_pitch_normal', nrmPng)).setNormalScale(1)
    .setMetallicRoughnessTexture(tex(id + '_pitch_orm', ormPng)).setMetallicFactor(1).setRoughnessFactor(1);
  for (const m of root.listMeshes()) m.setName(id);
  for (const n of root.listNodes()) n.setName(id);
  await io.write(OUT_GLB, doc);
  console.log(id + ' pitch: wrote', path.relative(ROOT, OUT_GLB), 'and', path.relative(ROOT, OUT_JPG));
}
