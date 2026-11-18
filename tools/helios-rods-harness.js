'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sharp = require('sharp');

global.self = global.window = global;
require('../vendor/three.bundle.js');
THREE.TextureLoader.prototype.load = function(_url, done) {
 const t = new THREE.Texture();
 queueMicrotask(() => done(t));
 return t;
};

const models = fs.readFileSync('js/models.js', 'utf8');
const world = fs.readFileSync('js/world.js', 'utf8');
const functions = [
 models.slice(models.indexOf('function makeRodModel('), models.indexOf('// --- grain tint:')),
 models.slice(models.indexOf('function onm('), models.indexOf('function ballKey(')),
 models.slice(models.indexOf('function cloneWithMaps('), models.indexOf('// --- fracture / explosion models ---'))
];
const teamGlow = [0x663bed, 0xeacc46].map(color => new THREE.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .55}));
for (const mat of teamGlow) mat.userData.fbOrig = {emissiveIntensity: .55};
const rodSets = {heliosRunners: {}};
const ctx = vm.createContext({
 THREE, rodSets, teamGlow, rodSetKey: () => 'heliosRunners',
 cfg: {redColor: '#d47bff', blueColor: '#31db9e'},
 teamMat: teamGlow.map(m => m.clone()), playerTeamMats: [{}, {}], netMats: teamGlow.map(m => m.clone()),
 document: {documentElement: {style: {setProperty() {}}}}, applyFinish() {}, drawField() {}, renderDirty() {}
});
vm.runInContext(functions.join('\n') + world.slice(world.indexOf('function kitLin('), world.indexOf('// surface finish (metalness')), ctx);

function assertHardware(grip, alloy, lights) {
 const m = grip.material;
 assert(grip.geometry.hasAttribute('tangent'));
 assert.equal(m.map.colorSpace, THREE.SRGBColorSpace);
 assert.equal(m.normalMap.colorSpace, THREE.NoColorSpace);
 assert(m.roughnessMap && m.roughnessMap === m.metalnessMap);
 assert.equal(m.roughnessMap.colorSpace, THREE.NoColorSpace);
 for (const mat of alloy) {
  assert.equal(mat.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(mat.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert(mat.metalness > .75);
 }
 for (const {geometry, material} of lights) {
  assert(/^team_glow/i.test(material.name));
  assert(geometry.hasAttribute('tangent'));
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.emissiveMap.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
 }
 const p = grip.geometry.attributes.position, no = grip.geometry.attributes.normal;
 for (let i = 0; i < p.count; i++) {
  assert(p.getX(i) * no.getX(i) + p.getY(i) * no.getY(i) > 0, 'outward grip normals');
 }
}

(async () => {
 for (const n of [1, 2, 3, 5]) {
  const b = fs.readFileSync(`assets/rods/helios_runners/fuzeball_rod_${n}man.glb`);
  const len = b.readUInt32LE(12), j = JSON.parse(b.toString('utf8', 20, 20 + len)), bin = 28 + len;
  for (const im of j.images) {
   const v = j.bufferViews[im.bufferView], start = bin + (v.byteOffset || 0);
   const meta = await sharp(b.subarray(start, start + v.byteLength)).metadata();
   assert(meta.width && meta.height);
  }
  const {scene} = await new THREE.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const find = (root, name) => root.getObjectByName(`rod${n}_${name}`);
  const glowMeshes = ['handle_knob_team_glow', 'end_collar_team_glow'];
  assertHardware(find(scene, 'handle_helios_grip'),
   ['handle_knob_alloy', 'end_collar_alloy'].map(name => find(scene, name).material),
   glowMeshes.map(name => find(scene, name)));
  rodSets.heliosRunners[n] = scene;
  for (const team of [0, 1]) {
   const live = ctx.makeRodModel(n, team, 'arena');
   assert.equal(live.userData.teamClones.length, 2);
   for (const name of glowMeshes) {
    const mat = find(live, name).material, authored = find(scene, name).material;
    assert.notEqual(mat, teamGlow[team]);
    assert(mat.color.equals(teamGlow[team].color) && mat.emissive.equals(teamGlow[team].emissive));
    assert.equal(mat.userData.fbOrig.emissiveIntensity, authored.emissiveIntensity);
    for (const key of ['emissiveMap', 'map', 'normalMap', 'roughnessMap']) assert.equal(mat[key], authored[key]);
    assert(live.userData.teamClones.some(c => c.mat === mat && c.isGlow));
   }
   assert.equal(find(live, 'handle_knob_alloy').material, find(scene, 'handle_knob_alloy').material);
   ctx.rodCustomMats = live.userData.teamClones.map(c => ({...c, team}));
   const hex = team === 0 ? ctx.cfg.redColor : ctx.cfg.blueColor;
   ctx.applyColors();
   for (const name of glowMeshes) {
    const mat = find(live, name).material;
    assert.equal(mat.emissive.getHexString(), hex.slice(1));
    assert(mat.color.equals(mat.emissive) && mat.emissiveMap);
   }
  }
 }
 console.log('Helios rods: all four sizes load with PBR in the correct color spaces and both inserts use live team glow.');
})().catch(e => {
 console.error(e);
 process.exitCode = 1;
});
