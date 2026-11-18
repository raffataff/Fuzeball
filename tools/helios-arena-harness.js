'use strict';
// Run from the project root: node tools/helios-arena-harness.js
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),sharp=require('sharp');
global.self=global.window=global;require('../vendor/three.bundle.js');
THREE.TextureLoader.prototype.load=function(_url,ok){const t=new THREE.Texture();queueMicrotask(()=>ok(t));return t;};
function extract(src,name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let d=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error(name);}
function glb(file){let b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));return {b,j,bin:20+len+8};}
const cx={console,localStorage:{getItem:()=>null,setItem(){},length:0,key:()=>null},Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN};cx.globalThis=cx;
vm.runInNewContext(fs.readFileSync('js/core.js','utf8')+'\n'+fs.readFileSync('js/config.js','utf8')+'\n;globalThis.result=CONFIG;',cx);
const CONFIG=cx.result,T=CONFIG.tables.arena,S=T.skins.heliosRunners,P=CONFIG.pitches.helios_runners;
assert(S&&P);const file=path.join(T.folder,S.glb),pitch=path.join(P.folder,P.glb);
const warnings=[],c={THREE,CONFIG,scene:new THREE.Group(),skinGroups:{},tableGroups:{},skinLoadingCbs:{},skinHasFrame:{},skinLed:{},skinRodHoles:{},skinOrder:[],glbGoalGrow:[[],[]],glbGoalWall:[[],[]],glbGoalSplit:[],rodHoleMeshes:[],console:{log(){},warn:(...x)=>warnings.push(x.join(' '))},morph:0};
c.newGLTF=()=>({load:(f,ok,_p,fail)=>{try{const b=fs.readFileSync(f);new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail);}catch(e){fail(e);}}});
c.registerArenaMorph=()=>c.morph++;
vm.createContext(c);const src=fs.readFileSync('js/models.js','utf8');
const world=fs.readFileSync('js/world.js','utf8');
vm.runInContext(['onm','skinKey','touchSkin','rodHoleShader','registerRodHoles','registerBigGoalMeshes','applyEmissiveStrength','loadSkin']
 .map(n=>extract(src,n)).concat(extract(world,'kitLin')).join('\n'),c);
(async()=>{
 for(const f of [file,pitch]){const {b,j,bin}=glb(f);for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];const m=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();assert(m.width&&m.height);}
  for(const m of j.materials||[])assert(!m.pbrMetallicRoughness?.baseColorTexture?.texCoord,'base color uses UV0');}
 await new Promise(resolve=>c.loadSkin('arena','heliosRunners',resolve));
 assert.deepEqual(warnings,[]);assert(c.skinHasFrame.arena.heliosRunners);assert.equal(c.morph,1);
 const lenses=c.skinRodHoles.arena.heliosRunners;
 assert.equal(lenses.length,8);
 assert(lenses.every(({o})=>o.geometry.hasAttribute('_stamina')));
 const root=c.skinGroups.arena.heliosRunners;let bowl=0,pbr=0;
 const goals=[];
 root.traverse(o=>{
  if(!o.isMesh)return;
  if(o.name.startsWith('arena_bowl')||o.parent?.name.startsWith('arena_bowl'))bowl++;
  if(o.name.startsWith('goal_frame'))goals.push(o);
  else if(o.material?.map&&o.material.normalMap&&o.material.roughnessMap&&o.material.metalnessMap)pbr++;
 });
 assert(pbr>0,'table PBR texture maps loaded');
 assert(bowl&&goals.length===2);assert(fs.existsSync(path.join('assets',P.tex)));
 for(const goal of goals){
  const m=goal.material;
  assert(goal.geometry.hasAttribute('uv'));
  const {position,normal}=goal.geometry.attributes,index=goal.geometry.index;
  const a=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3){
   const p=index.getX(i),q=index.getX(i+1),r=index.getX(i+2);
   a.fromBufferAttribute(position,p);ab.fromBufferAttribute(position,q).sub(a);ac.fromBufferAttribute(position,r).sub(a);
   n.fromBufferAttribute(normal,p);
   assert(ab.cross(ac).dot(n)>0,'goal triangle faces agree with normals on both sides');
  }
  assert.equal(m.map.colorSpace,THREE.SRGBColorSpace);
  assert.equal(m.emissiveMap.colorSpace,THREE.SRGBColorSpace);
  assert.equal(m.normalMap.colorSpace,THREE.NoColorSpace);
  assert(m.roughnessMap&&m.roughnessMap===m.metalnessMap&&m.roughnessMap===m.aoMap);
  assert.equal(m.roughnessMap.colorSpace,THREE.NoColorSpace);
  assert.equal(m.map.wrapS,THREE.ClampToEdgeWrapping);
  assert.equal(m.map.wrapT,THREE.RepeatWrapping);
 }
 assert.equal(goals[0].material,goals[1].material);
 assert(c.glbGoalGrow.every(meshes=>meshes.some(o=>goals.includes(o))), 'both frames registered for Big Goal');
 console.log('Helios Runners: arena and pitch maps decode, both frames load their PBR maps in the correct color spaces and register for Big Goal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
