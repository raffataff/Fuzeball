// Flatten the pitch GLBs to their top face. The pitch is a 120 x 68 slab with the pitch texture on every face, so the sides and underside show a stretched copy of the markings. Keeps only triangles whose three vertices sit on the top (max y); the rest are dropped with their vertices.
// USAGE
//   node tools/pitch-flat.mjs [file.glb ...]     default: every assets/pitches/pitch_*.glb
//   ... --dry     report the vertex and triangle counts without writing
// REQUIRES: npm i in tools/ (same deps as pitch-split.mjs)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flattenTop } from './pitchlib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const files = argv.filter((a) => !a.startsWith('--'));
const targets = files.length ? files : fs.readdirSync(path.join(ROOT, 'assets/pitches')).filter((f) => /^pitch_.*\.glb$/.test(f)).map((f) => path.join(ROOT, 'assets/pitches', f));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const file of targets) {
  const doc = await io.read(file);
  const before = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).map((p) => ({ v: p.getAttribute('POSITION').getCount(), t: (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3 }));
  if (DRY) { console.log(`${path.basename(file)}: ${JSON.stringify(before)}`); continue; }
  await flattenTop(doc);
  const after = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).map((p) => ({ v: p.getAttribute('POSITION').getCount(), t: p.getIndices().getCount() / 3 }));
  fs.writeFileSync(file, await io.writeBinary(doc));
  console.log(`${path.basename(file)}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
}
