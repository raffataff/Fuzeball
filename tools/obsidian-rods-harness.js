// Validate the exported rod sizes and their compatibility with the game loader.
'use strict';
const fs=require('fs'),assert=require('assert'),sharp=require('sharp');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
THREE.TextureLoader.prototype.load=function(_url,done){const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
async function load(file){
 const b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len).toString().trim()),bin=28+len;
 for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];const meta=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();assert(meta.width&&meta.height,'image decodes');}
 return new Promise((ok,fail)=>new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',g=>ok(g.scene),fail));
}
function find(root,predicate){let found;root.traverse(o=>{if(!found&&o.isMesh&&predicate(o))found=o;});return found;}
(async()=>{
 for(const n of [1,2,3,5]){
  const scene=await load(`assets/rods/obsidian_volt/fuzeball_rod_${n}man.glb`);
  const stock=await load(`assets/tables/classic/rods/fuzeball_rod_${n}man.glb`);
  const bar=find(scene,o=>o.name.toLowerCase().includes('_bar'));
  const oldBar=find(stock,o=>o.name.toLowerCase().includes('_bar'));
  const teamKnob=find(scene,o=>o.name.toLowerCase().includes('knob')&&/^team/i.test(o.material.name));
  const teamCollar=find(scene,o=>o.name.toLowerCase().includes('collar')&&/^team[_.]?glow/i.test(o.material.name));
  const grip=find(scene,o=>o.material.name.includes('forged carbon grip'));
  assert(bar&&oldBar&&teamKnob&&teamCollar,'bar, team knob and team-glow collar survive export');
  assert(grip&&grip.material.map&&grip.material.normalMap&&grip.material.roughnessMap&&grip.material.metalnessMap&&grip.material.emissiveMap,'grip PBR maps load');
  scene.updateMatrixWorld(true);stock.updateMatrixWorld(true);
  const a=new THREE.Box3().setFromObject(bar),b=new THREE.Box3().setFromObject(oldBar);
  for(const axis of ['x','y','z']) assert(Math.abs(a.min[axis]-b.min[axis])<.001&&Math.abs(a.max[axis]-b.max[axis])<.001,'stock bar bounds retained');
 }
 console.log('Obsidian Volt: four rod models parsed, PBR maps decoded, team parts and stock bar bounds preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
