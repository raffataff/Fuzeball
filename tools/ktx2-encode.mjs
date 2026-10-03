// KTX2 / Basis Universal texture compression for Fuzeball's GLBs.
// why: a PNG/JPEG in a GLB is uncompressed in VRAM (a 2048² albedo = 21.3MB); KTX2/Basis stays compressed to the GPU (a flat ~4x cut) and decodes in a worker, which also fixes the boot freeze
// two codecs picked by slot: ETC1S for baseColor and emissive (a colour codec, tiny files); UASTC for normal, metallicRoughness and occlusion (independent channels or a vector, so ETC1S would bleed them)
// a texture used in both kinds of slot is encoded as sRGB colour and reported (an upstream modelling mistake)
// every texture is resized to a multiple of 4 (basisu -resample): BC7 and S3TC refuse other sizes (ASTC tolerates them, so the bug would only show on some GPUs); at most 3px, reported per texture; --pot rounds to a power of two
// UASTC files often get bigger than the JPEG they replace; the point is VRAM and upload cost, so watch the VRAM column
// dedup runs first as insurance (a glTF `texture` is an (image, sampler) pair and an exporter can emit one image several times); it currently finds nothing
// the live count still inflates for a texture used in both an sRGB and a linear slot (GLTFLoader clones it); the fix is upstream, in the export
//
// USAGE
//   node tools/ktx2-encode.mjs <in.glb> [out.glb]          one file
//   node tools/ktx2-encode.mjs --dir assets/rooms          every .glb under a folder, in place*
//   ... --dry            report what it would do, encode nothing
//   ... --quality 160    ETC1S quality 1-255 (default 128; higher = better, bigger, slower)
//   ... --uastc-level 2  UASTC 0-4 (default 2)
//   ... --suffix .ktx2   write beside the original with this suffix instead of overwriting
//   ... --pot            round textures to a power of two instead of just a multiple of 4
//   ... --no-dedup       skip the duplicate-texture merge
// *"in place" writes a .bak next to the original the first time, and never overwrites a .bak
//
// no image library: basisu reads and resizes the images itself and @gltf-transform/core reads sizes from the file header, so the original bytes go straight to the encoder (sharp/libvips refused seven room textures on Windows); anything not PNG or JPEG is reported and left alone
//
// REQUIRES: npm i (see tools/package.json): @gltf-transform/core, extensions, functions, @gpu-tex-enc/basis
import { NodeIO, PropertyType, ImageUtils } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* ---- basisu binary, from the npm package's prebuilt set ------------------ */
function basisuBin() {
  const root = path.dirname(require.resolve('@gpu-tex-enc/basis/package.json'));
  const plat = { win32: 'win32', linux: 'linux', darwin: 'darwin' }[process.platform];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const dir = path.join(root, 'bin', `${plat}-${arch}`);
  for (const name of ['basisu.exe', 'basisu']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) { try { fs.chmodSync(p, 0o755); } catch {} return p; }
  }
  throw new Error(`no basisu binary for ${plat}-${arch} in ${dir}`);
}

/* ---- args ---------------------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const has  = (n) => argv.includes('--' + n);
const DRY  = has('dry');
const Q    = +flag('quality', 128);
const ULVL = +flag('uastc-level', 2);
const SUF  = flag('suffix', '');
const POT  = has('pot');
/* Block formats are 4x4 and BC7/S3TC reject a level that is not a multiple of 4 — see the header.
   Never scales a dimension to 0, and never grows one past the next power of two under --pot. */
const align4 = (v) => Math.max(4, Math.round(v / 4) * 4);
const pot    = (v) => Math.max(4, Math.pow(2, Math.round(Math.log2(v))));
const fit    = (v) => (POT ? pot(v) : align4(v));
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i-1].startsWith('--') && !['dry'].includes(argv[i-1].slice(2))));

// ---- slot classification ----
// the only thing that decides codec and colourspace; read from the materials, not file names
const SRGB_SLOTS   = new Set(['baseColor', 'emissive']);
const LINEAR_SLOTS = new Set(['normal', 'metallicRoughness', 'occlusion']);
const SLOT_GETTERS = [
  ['getBaseColorTexture', 'baseColor'], ['getEmissiveTexture', 'emissive'],
  ['getNormalTexture', 'normal'], ['getMetallicRoughnessTexture', 'metallicRoughness'],
  ['getOcclusionTexture', 'occlusion'],
];

const MB = (b) => (b / 1048576).toFixed(1);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function encodeOne(inPath, outPath) {
  // sampled up front: in-place writes replace the file, and reading it after reported the output size as both before and after
  const sizeBefore = fs.statSync(inPath).size;
  const doc = await io.read(inPath);
  // Before anything else: collapse texture entries that share an image. See the header — this is a
  // real VRAM saving, not housekeeping, and it stops basisu encoding the same bytes twice.
  const nTexBefore = doc.getRoot().listTextures().length;
  // textures only, with keepUniqueNames on: this codebase matches materials and meshes by name (teamParts on `kit_*`, the LED material, `goal_frame`/`wall_end`/`room_light_*`), so merging those would break recolour and the big-goal morph
  if (!has('no-dedup'))
    await doc.transform(dedup({ propertyTypes: [PropertyType.TEXTURE], keepUniqueNames: true }));
  const root = doc.getRoot();
  const merged = nTexBefore - root.listTextures().length;
  if (merged > 0) console.log(`  dedup: ${nTexBefore} texture entries -> ${root.listTextures().length} (${merged} shared an image)`);
  const basisu = basisuBin();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fzktx-'));

  const slots = new Map();
  for (const m of root.listMaterials())
    for (const [fn, slot] of SLOT_GETTERS) {
      const t = m[fn] && m[fn]();
      if (t) { if (!slots.has(t)) slots.set(t, new Set()); slots.get(t).add(slot); }
    }

  let vramBefore = 0, vramAfter = 0, fileBefore = 0, fileAfter = 0, n = 0, skipped = 0, mixed = 0;

  for (const [i, tex] of root.listTextures().entries()) {
    const img = tex.getImage();
    if (!img) { skipped++; continue; }
    if (tex.getMimeType() === 'image/ktx2') { skipped++; continue; }   // already done
    const used = slots.get(tex);
    if (!used || used.size === 0) {
      console.log(`  [${i}] ${tex.getName() || '(unnamed)'} — not used by any material slot, left alone`);
      skipped++; continue;
    }
    const isSRGB   = [...used].some((s) => SRGB_SLOTS.has(s));
    const isLinear = [...used].some((s) => LINEAR_SLOTS.has(s));
    if (isSRGB && isLinear) mixed++;
    const uastc = isLinear && !isSRGB;

    const mime = tex.getMimeType();
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : null;
    if (!ext) {
      console.warn(`  [${i}] ${mime} — basisu reads png/jpg/bmp/tga only, left uncompressed`);
      skipped++; continue;
    }
    const size = ImageUtils.getSize(img, mime);          // straight off the file header, no decode
    if (!size) { console.warn(`  [${i}] could not read ${mime} dimensions, left uncompressed`); skipped++; continue; }
    const w0 = size[0], h0 = size[1];
    const w = fit(w0), h = fit(h0);
    const resized = w !== w0 || h !== h0;

    if (DRY) {
      // a dry run writes nothing (it used to convert every texture through sharp first)
      console.log(`  [${i}] ${w0}x${h0}${resized ? ` -> ${w}x${h}` : ''} ${[...used].join('+')} -> ${uastc ? 'UASTC' : 'ETC1S'}`);
      vramBefore += w0*h0*4*(4/3); vramAfter += w*h*(4/3); fileBefore += img.byteLength;
      n++; continue;
    }

    // The original bytes, untouched, straight to the encoder. See the header.
    const src = path.join(tmp, `t${i}.${ext}`);
    fs.writeFileSync(src, Buffer.from(img));
    const dst = path.join(tmp, `t${i}.ktx2`);

    const args = ['-ktx2', '-mipmap', '-file', src, '-output_file', dst];
    if (resized) args.push('-resample', String(w), String(h));   // box filter; the nudge is <=3px
    if (uastc) args.push('-uastc', '-uastc_level', String(ULVL), '-linear');
    else args.push('-q', String(Q));
    if (used.has('normal')) args.push('-normal_map');

    try { execFileSync(basisu, args, { stdio: 'pipe' }); }
    catch (e) {
      console.warn(`  [${i}] basisu FAILED (${w}x${h} ${ext}) — left uncompressed: ${String(e.stderr || e).slice(0, 160)}`);
      skipped++; continue;
    }
    const out = fs.readFileSync(dst);
    tex.setImage(new Uint8Array(out)).setMimeType('image/ktx2');
    const uri = tex.getURI(); if (uri) tex.setURI(uri.replace(/\.(png|jpe?g|webp)$/i, '.ktx2'));
    console.log(`  [${i}] ${String(resized ? `${w0}x${h0}>${w}x${h}` : `${w}x${h}`).padEnd(17)} ${[...used].join('+').padEnd(28)} ` +
                `${(uastc ? 'UASTC' : 'ETC1S').padEnd(5)} ${MB(img.byteLength)}MB -> ${MB(out.byteLength)}MB file, ` +
                `${MB(w0*h0*4*4/3)}MB -> ${MB(w*h*4/3)}MB vram${resized ? '  (aligned)' : ''}`);
    vramBefore += w0*h0*4*(4/3); vramAfter += w*h*(4/3);
    fileBefore += img.byteLength; fileAfter += out.byteLength; n++;
  }

  if (mixed) console.warn(`  ! ${mixed} texture(s) used in BOTH colour and data slots — encoded as sRGB colour. ` +
                          `That is a modelling issue upstream; a normal map sharing an image with an albedo is a bug, not a saving.`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!n) { console.log('  already encoded — nothing to do'); return null; }

  if (!DRY) {
    // the .bak is taken here, after the parse and only when there's work to do; never overwrites an existing .bak (the first is the true pre-KTX2 copy)
    // it's a safety net for the first encode, not an undo stack; use git for that
    if (path.resolve(outPath) === path.resolve(inPath)) {
      const bak = inPath + '.bak';
      if (!fs.existsSync(bak)) { fs.copyFileSync(inPath, bak); console.log(`  (original backed up to ${path.basename(bak)})`); }
    }
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    const glb = await io.writeBinary(doc);
    fs.writeFileSync(outPath, glb);
  }
  return { n, skipped, vramBefore, vramAfter, fileBefore, fileAfter,
           sizeBefore, sizeAfter: DRY ? 0 : fs.statSync(outPath).size };
}

/* ---- driver -------------------------------------------------------------- */
function glbsUnder(dir) {
  const out = [], flat = has('no-recurse');
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!flat) walk(p); }
      else if (/\.glb$/i.test(e.name) && !/\.bak$/i.test(e.name)) out.push(p);
    }
  })(dir);
  return out.sort();
}

const dir = flag('dir', null);
const files = dir ? glbsUnder(dir) : positional.slice(0, 1);
if (!files.length) { console.error('usage: node tools/ktx2-encode.mjs <in.glb> [out.glb]  |  --dir <folder>'); process.exit(1); }

let TB = 0, TA = 0, FB = 0, FA = 0;
for (const f of files) {
  const out = dir || !positional[1] ? (SUF ? f.replace(/\.glb$/i, SUF + '.glb') : f) : positional[1];
  console.log(`\n### ${path.relative(process.cwd(), f)}${DRY ? '  (dry run)' : ''}`);
  const r = await encodeOne(f, out);
  if (!r) continue;
  TB += r.vramBefore; TA += r.vramAfter; FB += r.sizeBefore; FA += r.sizeAfter;
  console.log(`  = ${r.n} encoded, ${r.skipped} skipped | VRAM ${MB(r.vramBefore)}MB -> ${MB(r.vramAfter)}MB` +
              (DRY ? '' : ` | file ${MB(r.sizeBefore)}MB -> ${MB(r.sizeAfter)}MB`));
}
console.log(`\nTOTAL  VRAM ${MB(TB)}MB -> ${MB(TA)}MB  (${TB && (TB/TA).toFixed(1)}x)` +
            (DRY ? '' : `   |   on disk ${MB(FB)}MB -> ${MB(FA)}MB`));
