'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
THREE.TextureLoader.prototype.load=function(url,done){const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
function load(file){const b=fs.readFileSync(file);return new Promise((ok,fail)=>new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',g=>ok(g.scene),fail));}
function find(g,part){let o;g.traverse(x=>{if(x.isMesh&&x.name.toLowerCase().includes(part))o=x;});return o;}
(async()=>{
 const templates={};
 for(const n of [1,2,3,5]){
  const g=await load(`assets/rods/pro_league/fuzeball_rod_${n}man.glb`),stock=await load(`assets/rods/fuzeball_rod_${n}man.glb`);
  const grip=find(g,'handle_wrapped'),collar=find(g,'collar_wrapped'),cap=find(g,'handle_cap_edge'),bar=find(g,'_bar'),old=find(stock,'_bar');
  assert(grip&&collar&&cap&&bar&&old,'all rod parts exist');
  assert(grip.material.map&&grip.material.normalMap&&collar.material.map&&collar.material.normalMap,'wrap textures survive export');
  assert(/^team[_.]?glow/i.test(cap.material.name),'cap opts into team colour and boost');
  g.updateMatrixWorld(true);stock.updateMatrixWorld(true);
  const a=new THREE.Box3().setFromObject(bar),b=new THREE.Box3().setFromObject(old);
  for(const axis of ['x','y','z'])assert(Math.abs(a.min[axis]-b.min[axis])<.001&&Math.abs(a.max[axis]-b.max[axis])<.001,'bar geometry stays aligned');
  templates[n]=g;
 }
 const src=fs.readFileSync('js/models.js','utf8'),extract=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
 const ctx={THREE,rodSets:{proLeague:templates},teamGlow:[new THREE.MeshStandardMaterial({color:0xff0000,emissive:0x220000}),new THREE.MeshStandardMaterial({color:0x0000ff,emissive:0x000022})],teamMat:[],rodSetKey:()=> 'proLeague',rodGrainSet:()=>{}};
 vm.createContext(ctx);vm.runInContext(extract('function makeRodModel(','// --- grain tint')+extract('function onm(','function ballKey(')+extract('function cloneWithMaps(','// --- fracture')+';this.makeRodModel=makeRodModel;',ctx);
 for(const n of [1,2,3,5])for(const team of [0,1]){
  const g=ctx.makeRodModel(n,team,'classic'),cap=find(g,'handle_cap_edge');
  assert(cap.material.color.equals(ctx.teamGlow[team].color),'cap takes team colour');
  assert(cap.material===ctx.teamGlow[team]||(g.userData.teamClones||[]).some(c=>c.isGlow&&c.mat===cap.material),'cap participates in boost');
 }
 console.log('Pro League: four GLBs load, textures and bar alignment verified, both team colours and boost cap verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
