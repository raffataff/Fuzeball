// pitch-lines.mjs: a mask of each pitch's painted lines, for the line glow (js/show.js, CONFIG.show.lines)
//      cd tools && node pitch-lines.mjs [--only=neon,cyatron] [--dry]
// reads the base colour out of assets/pitches/<glb> (KTX2 through the game's own transcoder), keeps pixels that are near-white and brighter than their surroundings,
// drops specks and scratches (small connected pieces), softens the edge and writes assets/pitches/lines/<id>.png (grey, the pitch's own UV layout)
// a hand-painted assets/pitches/lines/src/<id>.png (white lines on black, any size) replaces the extraction for that pitch
// --dry writes only the review sheet: tools/build/pitch-lines/sheet.png (art | mask | the mask lit over the art), one row per pitch
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const OUT = path.join(ROOT, 'assets', 'pitches', 'lines');
const SHEET = path.join(here, 'build', 'pitch-lines');
const W = 1024;            // mask width (px); height follows the art
const WX = 2048;           // the art is read at this width (thin lines survive) and the mask scaled down to W
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? a.length : i), i < 0 ? true : a.slice(i + 1)]; }));

// --- extraction knobs ---
// lift: brighter than the local mean by this (0..1); white: brightness from which a pixel can be a line; chroma: max saturation of a line (1 = any colour)
// val: brightness is the brightest channel, not luma (coloured lines); blur: local mean radius (px at WX); keep: smallest piece kept (bounding-box span, px at WX)
// near: a line's surroundings may be no more saturated than this (drops white decor sitting in colour); median: speck filter (off for hairlines)
const BASE = { lift: [0.06, 0.16], white: [0.45, 0.7], chroma: [0.18, 0.32], val: false, blur: 16, keep: 80, near: 1, median: true, fat: 0 };   // fat: radius (px at WX) past which a shape is a decal, not a line: those regions are cut out
const PER = {
  neon: { val: true, chroma: [1, 1], lift: [0.03, 0.1], white: [0.35, 0.6] },   // pink / cyan neon tubes with a halo
  cyatron: { chroma: [1, 1] },
  obsidian_volt: { chroma: [1, 1], white: [0.3, 0.55] },
  alien_tech: { chroma: [1, 1], white: [0.3, 0.55] },
  strike: { fat: 5 },                                                           // the white slashes in the corners are thick
  federation_finals: { chroma: [0.4, 0.65], lift: [0.02, 0.06], white: [0.22, 0.36], blur: 8, median: false },
  helios_runners: { chroma: [0.35, 0.6], lift: [0.02, 0.06], white: [0.18, 0.32], blur: 8, median: false },
  silver_circuit: { chroma: [0.45, 0.7], lift: [0.02, 0.06], white: [0.2, 0.34], blur: 8, median: false },
  synaptic_relic: { val: true, chroma: [1, 1], lift: [0.03, 0.08], white: [0.22, 0.4], blur: 8, median: false },
};

async function transcoder() {
  const BASIS = require(path.join(ROOT, 'vendor', 'basis', 'basis_transcoder.js'));
  const wasmBinary = fs.readFileSync(path.join(ROOT, 'vendor', 'basis', 'basis_transcoder.wasm'));
  const mod = await new Promise(res => { const m = { wasmBinary, onRuntimeInitialized: () => res(m) }; BASIS(m); });
  mod.initializeBasis();
  return mod;
}
function ktx2(mod, bytes) {
  const f = new mod.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid() || !f.startTranscoding()) throw new Error('bad KTX2');
    const li = f.getImageLevelInfo(0, 0, 0), dst = new Uint8Array(f.getImageTranscodedSizeInBytes(0, 0, 0, 13));
    if (!f.transcodeImage(dst, 0, 0, 0, 13, 0, -1, -1)) throw new Error('transcode failed');
    return sharp(Buffer.from(dst.buffer), { raw: { width: li.origWidth, height: li.origHeight, channels: 4 } });
  } finally { f.close(); f.delete(); }
}
async function baseColour(io, mod, glb) {
  const doc = await io.read(glb);
  const m = doc.getRoot().listMaterials().find(m => m.getBaseColorTexture());
  if (!m) return null;
  const t = m.getBaseColorTexture();
  return t.getMimeType() === 'image/ktx2' ? ktx2(mod, t.getImage()) : sharp(Buffer.from(t.getImage()));
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6))); return t * t * (3 - 2 * t); };

// square min (erode) or max (grow) filter of a binary mask, radius r, as two separable passes over prefix counts
function morph(bin, w, h, r, grow) {
  const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
  const pass = (src, dst, n, m, at) => {
    const pre = new Int32Array(n + 1);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (src[at(i, j)] ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - r), hi = Math.min(n, i + r + 1), c = pre[hi] - pre[lo];
        dst[at(i, j)] = grow ? (c > 0 ? 1 : 0) : (c === 2 * r + 1 ? 1 : 0);
      }
    }
  };
  pass(bin, a, w, h, (i, j) => j * w + i);
  pass(a, b, h, w, (i, j) => i * w + j);
  return b;
}
// connected pieces of a binary mask (4-neighbour); pieces whose bounding box spans fewer than `keep` px are cleared
function dropSpecks(bin, w, h, keep) {
  const lab = new Int32Array(w * h).fill(-1), st = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || lab[i] >= 0) continue;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, top = 0;
    st[top++] = i; lab[i] = i;
    const members = [];
    while (top) {
      const p = st[--top], x = p % w, y = (p / w) | 0; members.push(p);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && bin[q] && lab[q] < 0) { lab[q] = i; st[top++] = q; }
    }
    if (Math.max(x1 - x0, y1 - y0) < keep) for (const p of members) bin[p] = 0;
  }
}

async function extract(img, id) {
  const K = Object.assign({}, BASE, PER[id] || {});
  const { data, info } = await img.clone().resize({ width: WX }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h, one = { raw: { width: w, height: h, channels: 1 } };
  const L = Buffer.alloc(n), C = Buffer.alloc(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = data[j], g = data[j + 1], b = data[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    L[i] = K.val ? mx : Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    C[i] = mx ? Math.round(255 * (mx - mn) / mx) : 0;
  }
  const bg = await sharp(L, one).blur(K.blur).extractChannel(0).raw().toBuffer();
  const cn = K.near < 1 ? await sharp(C, one).blur(K.blur).extractChannel(0).raw().toBuffer() : null;
  const soft = new Float32Array(n), bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = L[i] / 255;
    let s = ss(K.lift[0], K.lift[1], l - bg[i] / 255) * ss(K.white[0], K.white[1], l) * (1 - ss(K.chroma[0], K.chroma[1], C[i] / 255));
    if (cn && cn[i] / 255 > K.near) s = 0;
    soft[i] = s; bin[i] = s > 0.5 ? 1 : 0;
  }
  if (K.fat) { const thick = morph(morph(bin, w, h, K.fat, false), w, h, K.fat + 3, true); for (let i = 0; i < n; i++) if (thick[i]) bin[i] = 0; }
  dropSpecks(bin, w, h, K.keep);
  const raw = Buffer.alloc(n);
  for (let i = 0; i < n; i++) raw[i] = bin[i] ? Math.round(255 * Math.max(0.6, soft[i])) : 0;
  const med = K.median ? await sharp(raw, one).median(3).extractChannel(0).raw().toBuffer() : raw;
  const { data: out, info: oi } = await sharp(med, one).resize({ width: W, kernel: 'lanczos3' }).blur(0.8).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (!K.median) for (let i = 0; i < out.length; i++) out[i] = Math.min(255, out[i] * 1.8);   // hairlines thin out in the scale-down
  return { out, w: oi.width, h: oi.height };
}
async function painted(id) {
  const f = path.join(OUT, 'src', id + '.png');
  if (!fs.existsSync(f)) return null;
  const { data, info } = await sharp(f).resize({ width: W }).greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { out: data, w: info.width, h: info.height, painted: true };
}

const cfgSrc = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
const block = cfgSrc.slice(cfgSrc.indexOf(' pitches:{'), cfgSrc.indexOf('// ---- blade grass'));
const pitches = [...block.matchAll(/^\s+([a-z_]+):\s*\{folder:'([^']+)',\s*glb:'([^']+)'/gm)].map(m => ({ id: m[1], file: path.join(ROOT, m[2], m[3]) }));
const only = args.only ? String(args.only).split(',') : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const mod = await transcoder();
fs.mkdirSync(SHEET, { recursive: true });
if (!args.dry) fs.mkdirSync(OUT, { recursive: true });
const rows = [], TW = 420;
for (const p of pitches) {
  if (only && !only.includes(p.id)) continue;
  if (!fs.existsSync(p.file)) { console.log(p.id + ': no GLB'); continue; }
  const img = await baseColour(io, mod, p.file);
  if (!img) { console.log(p.id + ': no base colour'); continue; }
  const m = (await painted(p.id)) || (await extract(img, p.id));
  const png = await sharp(m.out, { raw: { width: m.w, height: m.h, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
  if (!args.dry) fs.writeFileSync(path.join(OUT, p.id + '.png'), png);
  let lit = 0; for (const v of m.out) lit += v; lit /= m.out.length * 255;
  console.log(p.id + ': ' + m.w + 'x' + m.h + (m.painted ? ' (painted)' : '') + ' coverage ' + (lit * 100).toFixed(2) + '% ' + png.length + ' bytes');
  const th = Math.round(TW * m.h / m.w);
  const art = await img.clone().resize({ width: TW, height: th, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const mk = await sharp(m.out, { raw: { width: m.w, height: m.h, channels: 1 } }).resize({ width: TW, height: th, fit: 'fill' }).extractChannel(0).raw().toBuffer();
  const ov = Buffer.alloc(TW * th * 3), mk3 = Buffer.alloc(TW * th * 3);
  for (let i = 0; i < TW * th; i++) {
    const k = mk[i] / 255;
    mk3[i * 3] = mk3[i * 3 + 1] = mk3[i * 3 + 2] = mk[i];
    ov[i * 3] = Math.min(255, art[i * 3] * 0.35 + 240 * k); ov[i * 3 + 1] = Math.min(255, art[i * 3 + 1] * 0.35 + 178 * k); ov[i * 3 + 2] = Math.min(255, art[i * 3 + 2] * 0.35 + 74 * k);
  }
  const label = Buffer.from(`<svg width="${TW * 3 + 20}" height="22"><text x="4" y="16" font-family="Arial" font-size="15" fill="#fff">${p.id}${m.painted ? ' (painted)' : ''} · ${(lit * 100).toFixed(1)}%</text></svg>`);
  rows.push({ h: th + 26, parts: [
    { input: label, top: 0, left: 0 },
    { input: await sharp(art, { raw: { width: TW, height: th, channels: 3 } }).png().toBuffer(), top: 24, left: 0 },
    { input: await sharp(mk3, { raw: { width: TW, height: th, channels: 3 } }).png().toBuffer(), top: 24, left: TW + 10 },
    { input: await sharp(ov, { raw: { width: TW, height: th, channels: 3 } }).png().toBuffer(), top: 24, left: TW * 2 + 20 },
  ] });
}
for (let k = 0; k < rows.length; k += 5) {
  const part = rows.slice(k, k + 5), H = part.reduce((a, r) => a + r.h, 0), comp = [];
  let y = 0; for (const r of part) { for (const q of r.parts) comp.push(Object.assign({}, q, { top: q.top + y })); y += r.h; }
  const f = path.join(SHEET, (only ? 'sheet_' + only.join('_') : 'sheet') + '_' + (k / 5 + 1) + '.png');
  await sharp({ create: { width: TW * 3 + 20, height: H, channels: 3, background: '#111' } }).composite(comp).png().toFile(f);
  console.log('sheet: ' + f);
}
