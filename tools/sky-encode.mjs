/* Room sky faces -> KTX2, for CONFIG.rooms.<id>.sky (models.js ensureSky).

   UASTC, NOT ETC1S, and that is the whole reason this is not just ktx2-encode.mjs. A sky is almost
   entirely smooth dark gradient, which is exactly what ETC1S's shared-endpoint codec turns into
   visible banding and blocky mud. UASTC transcodes to BC7/ASTC (1 byte/pixel, near-lossless), so a
   1024² face with mips is ~1.4MB of VRAM and the dither build_nebula_sky.py bakes in survives.
   Zstd supercompression (basisu's default for UASTC in a .ktx2) keeps the mostly-black files small.

   sRGB (no -linear): the faces are colour, and r128 decodes them in the shader like any sRGB map.
   Every face is resampled to one size (a multiple of 4 — BC7 refuses anything else, see
   ktx2-encode.mjs) and gets a full mip chain, because the background samples at a steep minification
   near the screen edges and aliased stars shimmer.

   USAGE (from the project root; needs `npm i` in tools/ once)
     node tools/sky-encode.mjs <srcDir> <outPrefix> [--size 1024] [--name nebula] [--level 2]
     e.g. node tools/sky-encode.mjs tools/build/sky/void assets/rooms/void/sky/nebula
   reads  <srcDir>/<name>_{px,nx,py,ny,pz,nz}.png
   writes <outPrefix>_{px,nx,py,ny,pz,nz}.ktx2 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'));
function basisuBin() {
  const root = path.dirname(require.resolve('@gpu-tex-enc/basis/package.json'));
  const plat = { win32: 'win32', linux: 'linux', darwin: 'darwin' }[process.platform];
  const dir = path.join(root, 'bin', `${plat}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`);
  for (const n of ['basisu.exe', 'basisu']) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; }
  throw new Error('no basisu binary in ' + dir);
}
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (pos.length < 2) { console.log('usage: node tools/sky-encode.mjs <srcDir> <outPrefix> [--size 1024] [--name nebula] [--level 2]'); process.exit(1); }
const [srcDir, outPrefix] = pos;
const SIZE = Math.max(4, Math.round(+flag('size', 1024) / 4) * 4);
const NAME = flag('name', path.basename(outPrefix));
const LVL = +flag('level', 2);
const bin = basisuBin();
fs.mkdirSync(path.dirname(outPrefix), { recursive: true });
let total = 0;
for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
  const src = path.join(srcDir, `${NAME}_${f}.png`), dst = `${outPrefix}_${f}.ktx2`;
  if (!fs.existsSync(src)) { console.error('missing ' + src); process.exit(1); }
  execFileSync(bin, ['-ktx2', '-uastc', '-uastc_level', String(LVL), '-mipmap', '-resample', String(SIZE), String(SIZE),
    '-file', src, '-output_file', dst], { stdio: 'pipe' });
  const kb = fs.statSync(dst).size / 1024; total += kb;
  console.log(`${path.basename(dst)}  ${SIZE}²  ${kb.toFixed(0)} KB`);
}
const vram = 6 * SIZE * SIZE * 4 / 3 / 1048576;
console.log(`total ${(total / 1024).toFixed(2)} MB on disk, ~${vram.toFixed(1)} MB VRAM (BC7/ASTC, with mips)`);
