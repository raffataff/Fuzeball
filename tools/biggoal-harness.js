// Exercise the real game morph on the stock and Silver Circuit geometry.
// Run from the project root: node tools/biggoal-harness.js
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
global.THREE=require('../vendor/three.min.js');global.self=global;
require('../vendor/GLTFLoader.js');
// Geometry and material wiring are under test; decoding images needs a DOM.
THREE.TextureLoader.prototype.load=function(_url,onLoad){
 const t=new THREE.Texture();queueMicrotask(()=>onLoad(t));return t;
};
function extract(src,name){
 const start=src.indexOf('function '+name+'(');if(start<0)throw Error('Missing '+name);
 let depth=0;for(let i=src.indexOf('{',start);i<src.length;i++){
  if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
 }
 throw Error('Unbalanced '+name);
}
const models=fs.readFileSync('js/models.js','utf8'),fx=fs.readFileSync('js/fx.js','utf8');
const files=['assets/tables/circuit/fuzeball_table_circuit.glb',
 'assets/tables/circuit/fuzeball_table_circuit_silver.glb'];
// This optional skin may be present in a workspace without being checked in.
const obsidian='assets/tables/circuit/fuzeball_table_circuit_obsidian.glb';
if(fs.existsSync(obsidian))files.push(obsidian);
async function check(file){
 const bytes=fs.readFileSync(file);
 const g=await new Promise((resolve,reject)=>new THREE.GLTFLoader().parse(
  bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));
  g.scene.updateMatrixWorld(true);
  const c={THREE,glbGoalGrow:[[],[]],glbGoalWall:[[],[]],glbGoalSplit:[],
   onm:o=>(o.name||'').toLowerCase(),console,goalFrames:[new THREE.Group(),new THREE.Group()],
   S:{time:0,eff:[{big:10},{big:10}]},PHY:{bigGoalMult:1.5,bigGoalBack:.5},
   F:{goalHalf:11,goalDepth:9},lerp:(a,b,t)=>a+(b-a)*t};
  vm.createContext(c);vm.runInContext(extract(models,'registerBigGoalMeshes')+'\n'+extract(fx,'bigGoalUpdate'),c);
  c.registerBigGoalMeshes(g.scene);
  const walls=c.glbGoalWall.flat();assert(walls.length>0,'end walls registered');
  const halo=g.scene.getObjectByName('goal_frame_silver_halo_inner_l');
  if(file.includes('_silver'))assert(halo,'silver halo exists');
  const before=halo&&new THREE.Box3().setFromObject(halo);
  c.bigGoalUpdate(1);g.scene.updateMatrixWorld(true);
  if(halo){const widened=new THREE.Box3().setFromObject(halo);
   assert(Math.abs(widened.max.z/before.max.z-1.5)<1e-5,'halo follows the goal');}
  for(const w of walls){
   assert(Number.isFinite(w.o.scale.z)&&Number.isFinite(w.o.position.z),'finite wall transform');
   const box=new THREE.Box3().setFromObject(w.o),has=v=>Math.min(Math.abs(box.min.z-v),Math.abs(box.max.z-v))<1e-4;
   assert(has(w.outer),'outer wall edge stays fixed');
   assert(has(w.inner+w.sgn*5.5),'inner wall edge moves by the goal widening');
  }
  c.S.time=11;c.bigGoalUpdate(1);g.scene.updateMatrixWorld(true);
  for(const w of walls){assert(Math.abs(w.o.scale.z-1)<1e-6,'wall scale restored');assert(Math.abs(w.o.position.z)<1e-6,'wall position restored');}
  if(halo){const restored=new THREE.Box3().setFromObject(halo);
   assert(Math.abs(restored.max.z-before.max.z)<1e-5,'halo restored');}
  console.log('Big-goal harness: '+file+' widened and restored cleanly.');
}
(async()=>{for(const file of files)await check(file);})().catch(e=>{console.error(e);process.exitCode=1;});
