// Run from the project root, then export the rods with build_federation_rods.py.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import sweep from './arena_goal_sweep.js';

const {sweepGoal, smooth, band, length} = sweep;
const arena = 'assets/tables/arena';
const mapDir = 'tools/build/federation-hardware/maps';
const gold = [.77, .57, .31], brightGold = [.88, .70, .43];
const bronze = [.27, .19, .13], enamel = [.085, .18, .22];
const amber = [1, .66, .30], black = [0, 0, 0];
const mix = (a, b, t) => a + (b - a) * t;
const paint = (a, b, t) => a.map((c, i) => mix(c, b[i], t));
const byte = x => Math.round(255 * Math.max(0, Math.min(1, x)));
const wave = x => Math.sin(Math.PI * 2 * x);

function noise(x, y) {
 const hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
 return (Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0) / 4294967295 - .5;
}

// A diamond and a pair of laurel branches, echoing the fascia and the pitch.
function crest(x, y) {
 const d = Math.abs(x) / .25 + Math.abs(y + .07) / .54;
 let mark = .85 * band(d, .63, 1, .1) + .86 * (1 - smooth(.43,.54,d));
 const a = Math.abs(x);
 for (let i = 0; i < 6; i++) {
  const t = i / 5, cx = .30 + .42 * Math.sin(t * 2), cy = .74 - 1.37 * t;
  const dx = a - cx, dy = y - cy;
  const long = (dx * (.65 - .43 * t) - dy * .93) / .19;
  const short = (dx * .93 + dy * (.65 - .43 * t)) / .066;
  mark = Math.max(mark, 1 - smooth(.78, 1.05, Math.hypot(long, short)));
 }
 return mark;
}

// Bake a height field and physically scaled glTF tangent normals alongside
// the colour, packed occlusion/roughness/metalness, and optional emission.
async function bake(w, h, sizeX, sizeY, sample, {wrap = true, light = false} = {}) {
 const maps = Object.fromEntries(['basecolor', 'normal', 'orm', ...(light ? ['emissive'] : [])]
  .map(name => [name, Buffer.alloc(w * h * 3)]));
 const relief = new Float32Array(w * h);
 for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x, k = i * 3;
  const {color, height, rough, metal, ao = 1, emission = black} = sample((x + .5) / w, (y + .5) / h, x, y);
  relief[i] = height;
  for (let c = 0; c < 3; c++) {
   maps.basecolor[k + c] = byte(color[c]);
   if (light) maps.emissive[k + c] = byte(emission[c]);
  }
  maps.orm[k] = byte(ao); maps.orm[k + 1] = byte(rough); maps.orm[k + 2] = byte(metal);
 }
 for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const row = y * w, k = (row + x) * 3;
  const up = (wrap ? (y - 1 + h) % h : Math.max(0, y - 1)) * w;
  const down = (wrap ? (y + 1) % h : Math.min(h - 1, y + 1)) * w;
  const nx = (relief[row + Math.max(0, x - 1)] - relief[row + Math.min(w - 1, x + 1)]) * w / (2 * sizeX);
  const ny = (relief[down + x] - relief[up + x]) * h / (2 * sizeY);
  const inv = .5 / Math.hypot(nx, ny, 1);
  maps.normal[k] = byte(.5 + nx * inv); maps.normal[k + 1] = byte(.5 + ny * inv); maps.normal[k + 2] = byte(.5 + inv);
 }
 return Object.fromEntries(await Promise.all(Object.entries(maps).map(async ([name, data]) => [name,
  await sharp(data, {raw: {width: w, height: h, channels: 3}}).png().toBuffer()])));
}

const section = [
 [0,.46,0], [.048,.46,.15], [.070,.47,.215], [.087,.58,.24], [.109,.635,.28], [.132,.61,.36],
 [.163,.46,.49], [.204,.24,.57], [.252,.01,.59], [.310,-.24,.55], [.359,-.44,.41],
 [.417,-.52,.22], [.5,-.535,0], [.583,-.52,-.22], [.641,-.44,-.41], [.690,-.24,-.55],
 [.748,.01,-.59], [.796,.24,-.57], [.837,.46,-.49], [.868,.61,-.36], [.891,.635,-.28],
 [.913,.58,-.24], [.930,.47,-.215], [.952,.46,-.15]
];

function goalDetails(end) {
 return {
  foot: 1 - smooth(.043, .057, end),
  ferrule: band(end, .061, .088, .007),
  joint: band(end, .223, .257, .008),
  badge: smooth(.445, .466, end)
 };
}

function goalGeometry(side) {
 return sweepGoal(side, section, (end, v, depth, radius) => {
  const {foot, ferrule, joint, badge} = goalDetails(end);
  const collar = .24 * foot + .105 * ferrule + .095 * joint;
  const raised = badge * (1 - smooth(.057, .089, Math.min(v, 1 - v)));
  return [depth * (1 + collar) + raised * .064, radius * (1 + 1.36 * collar) + .075 * foot];
 });
}

function goalFinish(u, v, x, y) {
 const end = Math.min(u, 1 - u), across = v > .5 ? v - 1 : v, front = Math.abs(across);
 const {foot, ferrule, joint, badge} = goalDetails(end);
 const channel = 1 - smooth(.066, .083, front);
 const bevel = band(front, .084, .161, .010);
 const innerPinstripe = band(front, .044, .058, .003) * (1 - Math.max(ferrule, joint));
 const ledWindow = Math.max(band(end, .145, .154, .002), band(end, .316, .331, .003));
 const diffuser = ledWindow * (1 - smooth(.020, .046, front));
 const heraldry = badge * channel * crest((u - .5) / .039, -across / .062);
 const bolt = 1 - smooth(.80, 1, Math.hypot((end - .026) / .007, across / .048));
 const slot = bolt * band(across, -.010, .012, .004);
 const collar = Math.max(ferrule, joint, band(end, .008, .016, .003), band(end, .038, .050, .004));
 const brass = Math.max(bevel, innerPinstripe, collar, heraldry, .73 * bolt);
 const brush = .5 * noise(x >> 2, y) + .28 * wave(v * 79) + .22 * wave(u * 217 + v * 4);
 const inlay = Math.max(channel * (1 - foot) * (1 - collar), band(front,.175,.287,.020));
 const undercoat = paint(bronze, enamel, inlay);
 const color = paint(paint(paint(undercoat, gold, brass), bronze, slot), amber, diffuser);
 return {color: color.map(c => c + brush * mix(.022, .090, brass)),
  height: .019 * heraldry - .029 * slot + .012 * diffuser + brush * .0034,
  rough: mix(mix(.44, .30, inlay), .27, brass) + .06 * brush,
  metal: mix(mix(.71, .13, inlay), .94, brass) * (1 - diffuser),
  ao: 1 - .20 * channel * (1 - Math.max(collar, diffuser, heraldry)), emission: paint(black, amber, diffuser)};
}

async function updateGoals(maps) {
 const io = new NodeIO();
 const file = join(arena, 'fuzeball_table_arena_federation.glb'), doc = await io.read(file);
 const root = doc.getRoot();
 const frames = root.listNodes().filter(n => n.getName().startsWith('goal_frame'));
 if (frames.length !== 2 || frames.some(n => n.getMesh().listPrimitives().length !== 1))
  throw Error('Expected two single-mesh Federation goal frames');
 const frameMaterial = 'Federation | cast bronze and coachline inlay';
 const material = root.listMaterials().find(m => m.getName() === frameMaterial) || doc.createMaterial(frameMaterial);
 const textures = Object.fromEntries(Object.entries(maps).map(([key, png]) => {
  const name = 'federation_goal_' + key;
  const map = root.listTextures().find(t => t.getName() === name) || doc.createTexture(name);
  return [key, map.setImage(png).setMimeType('image/png')];
 }));
 material.setBaseColorTexture(textures.basecolor).setMetallicRoughnessTexture(textures.orm)
  .setOcclusionTexture(textures.orm).setNormalTexture(textures.normal).setEmissiveTexture(textures.emissive)
  .setEmissiveFactor([.60, .58, .56]);
 for (const info of [material.getBaseColorTextureInfo(),material.getMetallicRoughnessTextureInfo(),
  material.getOcclusionTextureInfo(),material.getNormalTextureInfo(),material.getEmissiveTextureInfo()]) {
  info.setWrapS(33071).setWrapT(10497).setMinFilter(9987).setMagFilter(9729);
 }
 const oldIndices = new Set(), oldMaterials = new Set();
 for (const frame of frames) {
  const p = frame.getMesh().listPrimitives()[0], pos = p.getAttribute('POSITION');
  const side = Math.sign(pos.getMin([])[0]), g = goalGeometry(side);
  pos.setArray(g.positions);
  p.getAttribute('NORMAL').setArray(g.normals);
  p.getAttribute('TEXCOORD_0').setArray(g.uv);
  const old = p.getIndices();
  oldIndices.add(old); oldMaterials.add(p.getMaterial());
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(g.indices).setBuffer(old.getBuffer()));
  p.setMaterial(material);
 }
 for (const old of [...oldIndices, ...oldMaterials]) {
  if (old.listParents().every(p => p === root)) old.dispose();
 }
 await io.write(file, doc);
}

async function save(name, maps) {
 await Promise.all(Object.entries(maps).map(([key, image]) => writeFile(join(mapDir, `${name}_${key}.png`), image)));
}

await mkdir(mapDir, {recursive: true});
const w = 512, h = 256;
const wood = await sharp(join(arena, 'federation_finals/walnut_basecolor.png')).rotate(90)
 .resize(w, h, {fit: 'fill'}).removeAlpha().raw().toBuffer();
await Promise.all([
 bake(1024, 192, length, 3.8, goalFinish, {light: true}).then(updateGoals),
 bake(w, h, 8.4, 8.1, (u, v, x, y) => {
  const flutes = .5 + .5 * Math.cos(Math.PI * 16 * v);
  const shade = 1 - .29 * flutes * band(u, .13, .94, .13);
  const grain = [0,1,2].map(c => {
   const a = wood[(y*w+x)*3+c], b = wood[((h-1-y)*w+x)*3+c];
   return mix((a + b) * .5, a, smooth(0, .12, Math.min(v,1-v))) / 255;
  });
  const pore = grain[0] - .34;
  return {color: grain.map((c,i) => shade * (1.06 * c + [.025,.014,.004][i])),
   height: pore * .051 + .0019 * noise(x >> 2,y), rough: .39 - .20 * pore + .066 * (1 - shade), metal: 0};
 }).then(m => save('walnut', m)),
 bake(256, 128, 2.4, 8.6, (u,v,x,y) => {
  const tool = .38 * wave(u*41) + .24 * wave(u*92) + .38 * noise(x,y>>3);
  const patina = .16 + .11 * wave(u*3 + .25 * wave(v*5)) + .05 * wave(v*13+u*8);
  return {color: paint(brightGold, bronze, patina).map(c => c + .05 * tool),
   height: .0046 * tool, rough: .23 + .19 * patina + .055 * tool, metal: .91};
 }).then(m => save('brass', m)),
 bake(192, 112, 2.4, 7.8, (u,v,x,y) => {
  const tool = .55 * wave(u*29) + .22 * wave(u*67) + .23 * noise(x,y>>2);
  return {color: paint(bronze,[.39,.29,.23],.43+tool*.11),
   height: .0032*tool, rough: .43+.05*tool+.042*wave(u*4+v*7), metal: .72};
 }).then(m => save('bronze', m)),
 bake(192, 512, 1.15, 8, (u,v) => {
  const motif = crest(((v * 4 + .5) % 1 - .5) / .38, (u-.5)/.44);
  const wire = Math.max(band(u,.061,.090,.012), band(u,.910,.939,.012));
  const inlay = Math.max(motif,wire);
  const grain = wave(v*72) * wave(u*53);
  return {color: paint(enamel, brightGold, inlay), height: .023*inlay + .0011*grain,
   rough: mix(.30,.24,inlay)+.02*grain, metal: mix(.11,.89,inlay)};
 }).then(m => save('enamel', m)),
 bake(256, 256, 2.8, 2.8, (u,v) => {
  const x = u*2-1, y = v*2-1, r=Math.hypot(x,y);
  const relief = crest(x*1.27,y*1.27), border = band(r,.80,.87,.026);
  const tool = .5 * wave(r*39) + .24 * wave(r*66);
  return {color: paint(gold, brightGold, Math.max(relief,border)).map(c => c + tool*.048),
   height: .028*relief + .038*border + .0021*tool, rough: .31-.075*relief+.05*tool, metal: .94};
 }, {wrap: false}).then(m => save('medallion', m)),
 bake(96, 384, .50, 8.2, (u,v) => {
  const rim = band(u,.012,.988,.28), diffuser = .87 + .13 * wave(v*88);
  const albedo = .18 + rim * diffuser * .70, emission = .08 + rim * diffuser * .86;
  return {color: [albedo,albedo,albedo], height: .022*rim+.0032*rim*diffuser,
   rough: .43-.15*rim+.04*diffuser, metal: 0, emission: [emission,emission,emission]};
 }, {light:true}).then(m => save('lens', m))
]);
console.log('Federation goal frames rebuilt, rod PBR maps baked.');
