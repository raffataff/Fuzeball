// Integration check for the registered Solar Forge table and matching pitch.
// Run from the project root: node tools/solar-forge-harness.js
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),sharp=require('sharp');
global.self=global.window=global;require('../vendor/three.bundle.js');
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
const CONFIG=configContext.result,T=CONFIG.tables.circuit,S=T.skins.solarForge,P=CONFIG.pitches.solar_forge;
assert(S&&P,'registered skin and pitch');
const tableFile=path.join(T.folder,S.glb),pitchFile=path.join(P.folder,P.glb);
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
 await new Promise(resolve=>c.loadSkin('circuit','solarForge',resolve));
 await new Promise(resolve=>c.ensurePitch('solar_forge',resolve));
 assert.deepEqual(warnings,[],'loader warnings');
 assert(c.skinGroups.circuit.solarForge&&c.pitchGroups.solar_forge);
 assert.equal(c.skinRodHoles.circuit.solarForge.length,8);
 const table=c.skinGroups.circuit.solarForge;
 table.updateMatrixWorld(true);
 const rim=table.getObjectByName('forge_wall_rim');
 assert(rim?.isMesh,'one continuous mesh for the wall tops');
 const {material,geometry}=rim,{position,uv}=geometry.attributes;
 assert(material.map&&material.normalMap&&material.roughnessMap&&material.metalnessMap&&material.emissiveMap);
 assert(material.emissiveIntensity>1,'rim emission uses the authored strength');
 const point=new THREE.Vector3();
 const positions=[];
 for(let i=0;i<position.count;i++){
  point.fromBufferAttribute(position,i).applyMatrix4(rim.matrixWorld);
  assert(Math.abs(uv.getX(i)-(.5+point.x/140))<1e-5,'rim U follows the shared atlas');
  assert(Math.abs(uv.getY(i)-(.5+point.z/76))<1e-5,'rim V follows the shared atlas');
  positions.push(point.toArray().map(x=>x.toFixed(5)).join(','));
 }
 const edges=new Map(),indices=geometry.index.array;
 for(let i=0;i<indices.length;i+=3){
  for(let j=0;j<3;j++){
   const edge=[positions[indices[i+j]],positions[indices[i+(j+1)%3]]].sort().join('/');
   edges.set(edge,(edges.get(edge)||0)+1);
  }
 }
 const uses=[...edges.values()];
 assert(uses.every(n=>n===1||n===2),'rim has no overlapping faces');
 assert.equal(uses.filter(n=>n===1).length,8,'only the two four-sided perimeter edges are open');
 const inside=[];
 table.traverse(o=>{
  if(o.isMesh&&o.material.name==='Solar Forge | inner basalt wall')inside.push(o);
 });
 const ray=new THREE.Raycaster();
 for(const [axis,sign] of [[0,-1],[0,1],[2,-1],[2,1]]){
  const along=2-axis;
  const expected=axis===0?60:34;
  const hit=(height,offset)=>{
   const origin=new THREE.Vector3(0,height,0).setComponent(along,offset);
   const direction=new THREE.Vector3().setComponent(axis,sign);
   ray.set(origin,direction);
   const face=ray.intersectObjects(inside)[0];
   assert(face&&Math.abs(face.distance-expected)<.001,'interior return meets the wall at the original plane');
   return face.uv;
  };
  const below=hit(12.45,5), above=hit(12.55,5), across=hit(12.55,6);
  assert(Math.abs(above.x-below.x)<1e-5,'wall U is continuous across the return');
  assert(Math.abs(Math.abs(above.y-below.y)*768-1.95)<.01,'wall V is continuous across the return');
  assert(Math.abs(Math.abs(across.x-above.x)*4096-19.5)<.01,'wall U and V use the same texel density');
  hit(12.81,11);
  hit(15.48,11);
 }
 let pitch,pitchM;
 c.pitchGroups.solar_forge.traverse(o=>{if(o.isMesh){pitch=o.material;pitchM=o;}});
 assert(pitch?.map&&pitch.normalMap&&pitch.roughnessMap&&pitch.emissiveMap&&pitch.aoMap,'pitch PBR maps loaded');
 assert(pitchM.geometry.attributes.tangent,'pitch normal map uses the authored tangent basis');
 assert(pitch.isMeshPhysicalMaterial&&Math.abs(pitch.ior-P.ior)<1e-6,'pitch uses the lower-reflectance rock finish');
 assert.equal(pj.materials[0].extensions.KHR_materials_ior.ior,P.ior);
 assert.equal(pitch.emissiveIntensity,1.75,'pitch emission uses the authored strength');
 c.disposeTableSkin('circuit','solarForge');c.disposePitch('solar_forge');
 await new Promise(resolve=>c.loadSkin('circuit','solarForge',resolve));
 await new Promise(resolve=>c.ensurePitch('solar_forge',resolve));
 assert(c.skinGroups.circuit.solarForge&&c.pitchGroups.solar_forge);
 assert.deepEqual(warnings,[]);console.log('Solar Forge: embedded images, shared rim UVs, PBR maps, rod rings and reload passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
