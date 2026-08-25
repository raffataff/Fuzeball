/* Split the pitch atlas GLB into one minimal file per variant.

   WHY THIS EXISTS RATHER THAN "just export each one from Blender": a glTF exporter embeds the
   images the SCENE references, not the ones the selected mesh references. Exporting eight times
   with a different pitch selected produces eight copies of the whole atlas — measured on this
   project, 8 x ~28MB where the original was one 32MB file, and loading any one of them still
   fetches and decodes all 22 images. The saving has to be made after the export, on the glTF
   itself, by deleting the other meshes and pruning what is then unreferenced.

   THE VARIANT KEY IS THE MATERIAL NAME, NOT THE MESH NAME, and that distinction is load-bearing.
   Blender suffixes duplicate object names, so the atlas carries `champions_green` AND
   `champions_green.001`, and `verdant` AND `verdant.001`. models.js `ballKey()` strips a trailing
   `.NNN`, so those two pairs collapse onto one key each — which is why `champions_purple` and
   `pub_classic` have never resolved and have been silently falling back to their JPEGs. Their
   MATERIALS say exactly what they are (`field_champions_purple`, `field_pub_classic`), so that is
   what this reads. Output is named from the material, and CONFIG.pitches keeps the mapping from
   its own key to that filename — the same shape CONFIG.rooms already uses.

   USAGE
     node tools/pitch-split.mjs <atlas.glb> [outDir]
     ... --dry     report the split without writing
   Default outDir is the atlas's own folder. Refuses to overwrite the atlas itself.

   REQUIRES: npm i in tools/ (same deps as ktx2-encode.mjs). */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const [src, outArg] = argv.filter((a) => !a.startsWith('--'));
if (!src) { console.error('usage: node tools/pitch-split.mjs <atlas.glb> [outDir] [--dry]'); process.exit(1); }
const outDir = outArg || path.dirname(src);
const MB = (b) => (b / 1048576).toFixed(1);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/* material name -> file stem. `field_x`, `field.x` and a bare `x` all reduce to `x`. */
const keyOf = (name) => String(name || '').replace(/^field[._]?/i, '').replace(/[^A-Za-z0-9_]+/g, '_').toLowerCase();

const atlas = await io.read(src);
const variants = atlas.getRoot().listMeshes().map((m) => {
  const prim = m.listPrimitives()[0];
  const mat = prim && prim.getMaterial();
  return { mesh: m.getName(), material: mat ? mat.getName() : null, key: keyOf(mat && mat.getName()) };
});

const dupes = variants.map((v) => v.key).filter((k, i, a) => a.indexOf(k) !== i);
if (dupes.length) {
  console.error('REFUSING: two variants reduce to the same key — ' + [...new Set(dupes)].join(', ') +
    '\nThe material names are the identity here; fix them in Blender rather than letting one silently win.');
  process.exit(1);
}

console.log(`atlas: ${path.basename(src)}  ${MB(fs.statSync(src).size)}MB, ${variants.length} variants\n`);
let total = 0;
for (const v of variants) {
  const out = path.join(outDir, `pitch_${v.key}.glb`);
  if (path.resolve(out) === path.resolve(src)) { console.error(`  skip ${v.key}: would overwrite the atlas`); continue; }
  if (DRY) { console.log(`  ${v.key.padEnd(20)} <- mesh "${v.mesh}" / material "${v.material}"`); continue; }

  // Re-read per variant rather than cloning: dispose() mutates, and a fresh parse is cheap next
  // to being subtly wrong about what a half-disposed document still references.
  const doc = await io.read(src);
  for (const m of doc.getRoot().listMeshes()) {
    if (m.getName() === v.mesh) continue;
    for (const p of m.listParents()) if (p.propertyType === 'Node') p.dispose();
    m.dispose();
  }
  // prune() is what turns "no mesh points at this image" into "this image is gone". Without it the
  // file is the same size and the whole exercise is decorative.
  await doc.transform(prune());
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(out, glb);
  total += glb.byteLength;
  const left = doc.getRoot();
  console.log(`  ${('pitch_' + v.key + '.glb').padEnd(30)} ${MB(glb.byteLength).padStart(6)}MB  ` +
              `${left.listMeshes().length} mesh, ${left.listMaterials().length} mat, ${left.listTextures().length} tex` +
              `   [${v.material}]`);
}
if (!DRY) console.log(`\n  8 files, ${MB(total)}MB total (atlas was ${MB(fs.statSync(src).size)}MB, and every variant paid all of it)`);
