'use strict';
// Run from the project root: node tools/federation-arena-harness.js
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),sharp=require('sharp');
global.self=global.window=global;require('../vendor/three.bundle.js');
THREE.TextureLoader.prototype.load=function(_url,ok){const t=new THREE.Texture();queueMicrotask(()=>ok(t));return t;};
function extract(src,name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let d=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error(name);}
function glb(file){let b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));return {b,j,bin:20+len+8};}
const cx={console,localStorage:{getItem:()=>null,setItem(){},length:0,key:()=>null},Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN};cx.globalThis=cx;
vm.runInNewContext(fs.readFileSync('js/core.js','utf8')+'\n'+fs.readFileSync('js/config.js','utf8')+'\n;globalThis.result=CONFIG;',cx);
const CONFIG=cx.result,T=CONFIG.tables.arena,S=T.skins.federationFinals,P=CONFIG.pitches.federation_finals;
assert(S&&P);const file=path.join(T.folder,S.glb),pitch=path.join(P.folder,P.glb);
const warnings=[],c={THREE,CONFIG,scene:new THREE.Group(),skinGroups:{},tableGroups:{},skinLoadingCbs:{},skinHasFrame:{},skinLed:{},skinRodHoles:{},skinOrder:[],glbGoalGrow:[[],[]],glbGoalWall:[[],[]],glbGoalSplit:[],rodHoleMeshes:[],console:{log(){},warn:(...x)=>warnings.push(x.join(' '))},morph:0};
const ROD_SIZES=[1,2,3,5],swatches=['#d47bff','#31db9e'];
const teamMaterial=()=>new THREE.MeshStandardMaterial({emissiveIntensity:.55});
Object.assign(c,{ROD_SIZES,rodSets:{},rodSetLoading:{},curSkin:()=> 'federationFinals',
 teamMat:swatches.map(teamMaterial),teamGlow:swatches.map(teamMaterial),netMats:swatches.map(teamMaterial),playerTeamMats:[{},{}],
 cfg:{redColor:swatches[0],blueColor:swatches[1]},rodCustomMats:[],
 document:{documentElement:{style:{setProperty(){}}}},applyFinish(){},drawField(){},renderDirty(){}});
c.newGLTF=()=>({load:(f,ok,_p,fail)=>{try{const b=fs.readFileSync(f);new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail);}catch(e){fail(e);}}});
c.registerArenaMorph=()=>c.morph++;
vm.createContext(c);const src=fs.readFileSync('js/models.js','utf8');
const world=fs.readFileSync('js/world.js','utf8');
const methods=['onm','skinKey','touchSkin','rodHoleShader','registerRodHoles','registerBigGoalMeshes','applyEmissiveStrength','loadSkin',
 'rodSetKey','loadRodSet','ensureTableRods','makeRodModel','cloneWithMaps'];
vm.runInContext(methods.map(n=>extract(src,n)).concat(['kitLin','applyColors'].map(n=>extract(world,n))).join('\n'),c);

async function verifyImages(f){
 const {b,j,bin}=glb(f);
 for(const im of j.images||[]){
  const v=j.bufferViews[im.bufferView];
  const meta=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();
  assert(meta.width&&meta.height);
 }
 for(const m of j.materials||[])assert(!m.pbrMetallicRoughness?.baseColorTexture?.texCoord,'base color uses UV0');
}

function verifyPbr(m){
 assert.equal(m.map.colorSpace,THREE.SRGBColorSpace);
 assert.equal(m.normalMap.colorSpace,THREE.NoColorSpace);
 assert(m.roughnessMap===m.metalnessMap&&m.roughnessMap.colorSpace===THREE.NoColorSpace);
}

function verifyGoal(mesh){
 const {geometry:g,material:m}=mesh;
 verifyPbr(m);
 assert.equal(m.emissiveMap.colorSpace,THREE.SRGBColorSpace);
 assert.equal(m.aoMap,m.roughnessMap);
 const {position,normal}=g.attributes;
 const a=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();
 for(let i=0;i<g.index.count;i+=3){
  const p=g.index.getX(i),q=g.index.getX(i+1),r=g.index.getX(i+2);
  a.fromBufferAttribute(position,p);ab.fromBufferAttribute(position,q).sub(a);ac.fromBufferAttribute(position,r).sub(a);
  assert(ab.cross(ac).dot(n.fromBufferAttribute(normal,p))>0,'outward triangle winding');
 }
}

function verifyRod(men){
 const tpl=c.rodSets.federationFinals[men], part=(root,name)=>root.getObjectByName(`rod${men}_${name}`);
 const grip=part(tpl,'handle_walnut_grip');
 verifyPbr(grip.material);
 assert(grip.geometry.hasAttribute('tangent'));
 const hardware=['handle_medallion','handle_knob_alloy','handle_neck_enamel','end_collar_alloy'];
 for(const name of hardware)verifyPbr(part(tpl,name).material);
 c.rodCustomMats=[];
 const live=swatches.map((_,team)=>{
  const clone=c.makeRodModel(men,team,'arena');
  assert.equal(clone.userData.teamClones.length,2);
  c.rodCustomMats.push(...clone.userData.teamClones.map(record=>({...record,team})));
  return clone;
 });
 c.applyColors();
 for(const [team,clone] of live.entries()){
  for(const name of ['handle_knob_team_glow','end_collar_team_glow']){
   const src=part(tpl,name).material, m=part(clone,name).material;
   verifyPbr(m);
   assert.equal(m.emissiveMap,src.emissiveMap);
   assert.equal(m.emissiveMap.colorSpace,THREE.SRGBColorSpace);
   assert.equal(m.emissive.getHexString(),swatches[team].slice(1));
   assert(m.color.equals(m.emissive));
  }
  for(const name of hardware)assert.equal(part(clone,name).material,part(tpl,name).material);
 }
}

(async()=>{
 assert.equal(c.rodSetKey('arena'),'federationFinals');
 assert.equal(c.rodSetKey('arena','standard'),'arenaComet');
 const rods=CONFIG.rodSets.federationFinals.folder;
 await Promise.all([file,pitch,...ROD_SIZES.map(men=>path.join(rods,`fuzeball_rod_${men}man.glb`))].map(verifyImages));
 await Promise.all([new Promise(resolve=>c.loadSkin('arena','federationFinals',resolve)),
  new Promise(resolve=>c.ensureTableRods('arena',resolve))]);
 assert.deepEqual(warnings,[]);assert(c.skinHasFrame.arena.federationFinals);assert.equal(c.morph,1);
 const root=c.skinGroups.arena.federationFinals,goals=[];let bowl=0,pbr=0;
 root.traverse(o=>{if(o.isMesh&&(o.name.startsWith('arena_bowl')||o.parent?.name.startsWith('arena_bowl')))bowl++;
  if(o.isMesh&&o.name.startsWith('goal_frame'))goals.push(o);
  else if(o.isMesh&&o.material?.map&&o.material.normalMap&&o.material.roughnessMap&&o.material.metalnessMap)pbr++;});
 assert(pbr>0,'table PBR texture maps loaded');
 assert(bowl&&goals.length===2);assert(fs.existsSync(path.join('assets',P.tex)));
 goals.forEach(verifyGoal);
 assert(c.glbGoalGrow.every(meshes=>meshes.some(o=>goals.includes(o))),'both goals register for Big Goal');
 ROD_SIZES.forEach(verifyRod);
 console.log('Federation Finals: arena, goal frames and all four rod sizes load with PBR. Big Goal registration and live team colours pass.');
})().catch(e=>{console.error(e);process.exitCode=1;});
