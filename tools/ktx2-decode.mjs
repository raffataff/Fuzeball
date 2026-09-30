/* KTX2 -> PNG: turn a shipped Fuzeball GLB back into one that Blender can open.

   WHY: the game's GLBs carry their textures as KTX2/Basis (KHR_texture_basisu; see ktx2-encode.mjs) because that stays
   compressed all the way to the GPU. Blender's glTF importer does not implement the extension and refuses the file
   outright ("Extension KHR_texture_basisu is not available"). This is the reverse of ktx2-encode.mjs: it transcodes
   every KTX2 image to RGBA with the SAME Basis transcoder the game ships (vendor/basis, r137, ETC1S + UASTC + Zstd),
   writes it as PNG, and drops the extension, leaving everything else in the file untouched (nodes, animations,
   materials, KHR_materials_clearcoat, KHR_texture_transform, ...).

   The Shardsmith Blender add-on runs this for you (Import Game GLB); it is also usable on its own:

       node tools/ktx2-decode.mjs <in.glb> <out.glb> [--max-size 2048]

   --max-size N   decode the smallest mip level that is <= N pixels on its longer side (default: full size).
                  A 4096² ETC1S albedo is 64MB of RAM in Blender once decoded; fracturing rarely needs that.

   NORMAL MAPS: the encoder stores them as two channels (RG). If the transcoded blue channel is not already ~1 the
   normal is rebuilt as z = sqrt(1 - x² - y²), so Blender's Normal Map node gets a valid vector.

   Prints one line per image and a final JSON line ({"images":[...]}) that the add-on reads.
   REQUIRES: npm i in tools/ (@gltf-transform/core, @gltf-transform/extensions, sharp). No basisu binary needed. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const RGBA32 = 13; // KTX2Loader.TranscoderFormat.RGBA32

function parseArgs(argv) {
  const pos = [];
  let maxSize = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-size') maxSize = parseInt(argv[++i], 10) || 0;
    else pos.push(argv[i]);
  }
  if (pos.length < 2) {
    console.error('usage: node ktx2-decode.mjs <in.glb> <out.glb> [--max-size N]');
    process.exit(2);
  }
  return { input: pos[0], output: pos[1], maxSize };
}

/* The transcoder is an emscripten module: BASIS(module) starts it, onRuntimeInitialized fires when the wasm is up. */
async function loadTranscoder() {
  const BASIS = require(path.join(here, '..', 'vendor', 'basis', 'basis_transcoder.js'));
  const wasmBinary = fs.readFileSync(path.join(here, '..', 'vendor', 'basis', 'basis_transcoder.wasm'));
  const mod = await new Promise((resolve) => {
    const m = { wasmBinary, onRuntimeInitialized: () => resolve(m) };
    BASIS(m);
  });
  mod.initializeBasis();
  if (mod.KTX2File === undefined) throw new Error('this transcoder build has no KTX2 support');
  return mod;
}

function decode(mod, bytes, maxSize) {
  const f = new mod.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid()) throw new Error('not a valid KTX2 file');
    const levels = f.getLevels();
    const uastc = typeof f.isUASTC === 'function' ? f.isUASTC() : false;
    let level = 0;
    if (maxSize > 0) {
      for (level = 0; level < levels - 1; level++) {
        const li = f.getImageLevelInfo(level, 0, 0);
        if (Math.max(li.origWidth, li.origHeight) <= maxSize) break;
      }
    }
    const li = f.getImageLevelInfo(level, 0, 0);
    if (!f.startTranscoding()) throw new Error('startTranscoding failed');
    const dst = new Uint8Array(f.getImageTranscodedSizeInBytes(level, 0, 0, RGBA32));
    if (!f.transcodeImage(dst, level, 0, 0, RGBA32, 0, -1, -1)) throw new Error('transcodeImage failed');
    return { rgba: dst, width: li.origWidth, height: li.origHeight, uastc, levels, level };
  } finally {
    f.close();
    f.delete();
  }
}

function channelMeans(rgba) {
  const n = rgba.length / 4;
  const step = Math.max(1, Math.floor(n / 20000));
  const s = [0, 0, 0, 0];
  let c = 0;
  for (let i = 0; i < n; i += step, c++) for (let k = 0; k < 4; k++) s[k] += rgba[i * 4 + k];
  return s.map((v) => v / c / 255);
}

/* Blue channel of a two-channel normal map: rebuild it from R and G when it is not already the up vector. */
function rebuildNormalZ(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const x = (rgba[i] / 255) * 2 - 1;
    const y = (rgba[i + 1] / 255) * 2 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    rgba[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
    rgba[i + 3] = 255;
  }
}

async function main() {
  const { input, output, maxSize } = parseArgs(process.argv.slice(2));
  const mod = await loadTranscoder();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const root = doc.getRoot();

  const normalTextures = new Set();
  for (const m of root.listMaterials()) if (m.getNormalTexture()) normalTextures.add(m.getNormalTexture());

  const report = [];
  let idx = 0;
  for (const tex of root.listTextures()) {
    const name = tex.getName() || `image${idx}`;
    const mime = tex.getMimeType();
    idx++;
    if (mime !== 'image/ktx2') {
      report.push({ name, mime, decoded: false });
      continue;
    }
    const d = decode(mod, tex.getImage(), maxSize);
    const before = channelMeans(d.rgba);
    let fixed = false;
    if (normalTextures.has(tex) && before[2] < 0.75) {
      rebuildNormalZ(d.rgba);
      fixed = true;
    }
    const png = await sharp(Buffer.from(d.rgba.buffer, d.rgba.byteOffset, d.rgba.length), {
      raw: { width: d.width, height: d.height, channels: 4 },
    }).png({ compressionLevel: 3 }).toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType('image/png');
    const after = channelMeans(d.rgba);
    const codec = d.uastc ? 'UASTC' : 'ETC1S';
    console.log(`  ${name}: ${d.width}x${d.height} ${codec} mip ${d.level}/${d.levels} ` +
      `mean rgba ${after.map((v) => v.toFixed(2)).join(' ')}${fixed ? ' (normal Z rebuilt)' : ''}`);
    report.push({ name, mime: 'image/ktx2', decoded: true, width: d.width, height: d.height, codec, normal: normalTextures.has(tex) });
  }

  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_texture_basisu') ext.dispose();
  await io.write(output, doc);
  console.log(JSON.stringify({ images: report, output }));
}

main().catch((e) => {
  console.error('ktx2-decode failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
