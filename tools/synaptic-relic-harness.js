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
const CONFIG=configContext.result,T=CONFIG.tables.circuit,S=T.skins.synapticRelic,P=CONFIG.pitches.synaptic_relic;
assert(S&&P,'registered skin and pitch');
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
 assert(tj.images.length>=5&&pj.images.length>=4,'embedded PBR maps');
 await new Promise(resolve=>c.loadSkin('circuit','synapticRelic',resolve));
 await new Promise(resolve=>c.ensurePitch('synaptic_relic',resolve));
 assert.deepEqual(warnings,[],'loader warnings');
 assert(c.skinGroups.circuit.synapticRelic&&c.pitchGroups.synaptic_relic);
 assert.equal(c.skinRodHoles.circuit.synapticRelic.length,8);
 let mapped=false, pitch=false;
 c.skinGroups.circuit.synapticRelic.traverse(o=>{if(o.isMesh&&o.material&&o.material.map&&o.material.normalMap&&o.material.metalnessMap) mapped=true;});
 c.pitchGroups.synaptic_relic.traverse(o=>{if(o.isMesh&&o.material.map&&o.material.normalMap&&o.material.roughnessMap&&o.material.emissiveMap)pitch=true;});
 assert(mapped&&pitch,'PBR maps loaded');
 c.disposeTableSkin('circuit','synapticRelic');c.disposePitch('synaptic_relic');
 await new Promise(resolve=>c.loadSkin('circuit','synapticRelic',resolve));
 await new Promise(resolve=>c.ensurePitch('synaptic_relic',resolve));
 assert(c.skinGroups.circuit.synapticRelic&&c.pitchGroups.synaptic_relic);
 assert.deepEqual(warnings,[]);console.log('Synaptic Relic: embedded images, game loader, PBR maps, rod rings and reload passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
