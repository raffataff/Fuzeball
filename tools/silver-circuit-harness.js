// Integration check for the registered Silver Circuit table and matching pitch.
// Run from the project root: node tools/silver-circuit-harness.js
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),sharp=require('sharp');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
// The r128 loader needs a browser to upload images. Decode the embedded images
// independently below, while retaining real geometry/material parsing here.
THREE.TextureLoader.prototype.load=function(_url,onLoad){const t=new THREE.Texture();queueMicrotask(()=>onLoad(t));return t;};
function extract(src,name){
 const start=src.indexOf('function '+name+'(');if(start<0)throw Error('Missing '+name);
 let depth=0;for(let i=src.indexOf('{',start);i<src.length;i++){
  if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
 }
 throw Error('Unbalanced '+name);
}
function readGLB(file){
 const b=fs.readFileSync(file);assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);
 const len=b.readUInt32LE(12),json=JSON.parse(b.subarray(20,20+len).toString().trim());
 const binStart=20+len+8;return {b,json,binStart};
}
async function validateImages(file){
 const {b,json,binStart}=readGLB(file);
 for(const img of json.images||[]){
  assert(Number.isInteger(img.bufferView),'embedded image required');
  const v=json.bufferViews[img.bufferView],start=binStart+(v.byteOffset||0);
  const meta=await sharp(b.subarray(start,start+v.byteLength)).metadata();
  assert(meta.width&&meta.height,'image must decode');
 }
 return json;
}
const source=fs.readFileSync('js/models.js','utf8');
const configContext={console,localStorage:{getItem:()=>null,setItem(){},length:0,key:()=>null},
 Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN};configContext.globalThis=configContext;
vm.runInNewContext(fs.readFileSync('js/core.js','utf8')+'\n'+fs.readFileSync('js/config.js','utf8')+'\n;globalThis.result=CONFIG;',configContext);
const CONFIG=configContext.result,T=CONFIG.tables.circuit,S=T.skins.silverCircuit,P=CONFIG.pitches.silver_circuit;
assert(S&&P&&S.hideGoalNet,'registered skin, pitch and dark goal setting');
const tableFile=path.join(T.folder,S.glb),pitchFile=path.join(P.folder,P.glb),fallback=path.join('assets',P.tex);
const warnings=[],c={THREE,CONFIG,scene:new THREE.Group(),skinGroups:{},tableGroups:{},skinLoadingCbs:{},
 skinHasFrame:{},skinLed:{},skinRodHoles:{},skinOrder:[],glbGoalGrow:[[],[]],glbGoalWall:[[],[]],glbGoalSplit:[],
 pitchGroups:{},pitchLoading:{},pitchFailed:{},pitchOrder:[],rodHoleMeshes:[],primLedMat:new THREE.MeshStandardMaterial(),kitLin:x=>new THREE.Color(x),
 console:{log(){},warn:(...args)=>warnings.push(args.join(' '))}};
c.newGLTF=()=>({load:(file,ok,_progress,fail)=>{try{
 const b=fs.readFileSync(file);new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail);
 }catch(e){fail(e);}}});
vm.createContext(c);vm.runInContext(['onm','skinKey','touchSkin','rodHoleShader','registerRodHoles',
 'registerBigGoalMeshes','applyEmissiveStrength','loadSkin','disposeTableSkin','pitchHasGlb','touchPitch','ensurePitch','disposePitch']
 .map(name=>extract(source,name)).join('\n')+'\n'+extract(fs.readFileSync('js/world.js','utf8'),'disposeModelTemplate'),c);
(async()=>{
 const tj=await validateImages(tableFile),pj=await validateImages(pitchFile);
 assert((tj.images||[]).length>0&&(pj.images||[]).length>0,'embedded texture maps');
 await new Promise(resolve=>c.loadSkin('circuit','silverCircuit',resolve));
 await new Promise(resolve=>c.ensurePitch('silver_circuit',resolve));
 assert.deepEqual(warnings,[],'loader warnings');
 const root=c.skinGroups.circuit.silverCircuit.children[0],halos=[];let goal;
 root.traverse(o=>{if(o.isMesh&&o.name.startsWith('goal_frame_silver_halo_'))halos.push(o);
  if(o.name==='goal_frame_l001')goal=o;});
 assert.equal(halos.length,4);assert(halos.every(o=>o.material.transparent&&!o.material.depthWrite&&!o.castShadow));
 assert(goal&&goal.material.emissiveIntensity>2,'goal emission strength');
 assert.equal(c.skinRodHoles.circuit.silverCircuit.length,8,'all rod rings');
 assert(c.glbGoalGrow.every(a=>a.filter(o=>o.name.includes('halo')).length===2),'halos follow both goals');
 let pitch;assert(c.pitchGroups.silver_circuit,'pitch resident');
 c.pitchGroups.silver_circuit.traverse(o=>{if(o.isMesh)pitch=o;});
 assert(pitch&&pitch.material.isMeshPhysicalMaterial&&Math.abs(pitch.material.ior-P.ior)<1e-6);
 assert(pitch.material.map&&pitch.material.normalMap&&pitch.material.roughnessMap&&pitch.material.metalnessMap&&pitch.material.emissiveMap);
 // LRU eviction must unregister moving goal pieces and release the old models;
 // reloading must reconstruct the same skin and pitch without stale ownership.
 let oldPitchDisposed=0;pitch.material.addEventListener('dispose',()=>oldPitchDisposed++);
 c.ledMat=c.skinLed.circuit.silverCircuit;c.rodHoleMeshes=c.skinRodHoles.circuit.silverCircuit;
 c.disposeTableSkin('circuit','silverCircuit');c.disposePitch('silver_circuit');
 assert(!c.skinGroups.circuit.silverCircuit&&!c.pitchGroups.silver_circuit);
 assert(c.glbGoalGrow.every(a=>a.length===0)&&c.glbGoalWall.every(a=>a.length===0));
 assert(c.ledMat===c.primLedMat&&c.rodHoleMeshes.length===0&&oldPitchDisposed>0);
 await new Promise(resolve=>c.loadSkin('circuit','silverCircuit',resolve));
 await new Promise(resolve=>c.ensurePitch('silver_circuit',resolve));
 assert(c.skinGroups.circuit.silverCircuit.children[0]!==root&&c.pitchGroups.silver_circuit);
 assert.equal(c.skinRodHoles.circuit.silverCircuit.length,8);assert.deepEqual(warnings,[],'reload warnings');
 const image=await sharp(fallback).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const pixel=(x,z)=>{const i=Math.floor((x+60)/120*image.info.width),j=Math.floor((z+34)/68*image.info.height);
  return image.data[(j*image.info.width+i)*image.info.channels+1];};
 assert(pixel(0,20)>pixel(3,20)+25,'fallback includes halfway line');
 console.log('Silver Circuit: real loader, maps, goal effects, rod rings, marked pitch and eviction/reload passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
