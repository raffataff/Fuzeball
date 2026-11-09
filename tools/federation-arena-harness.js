'use strict';
// Run from the project root: node tools/federation-arena-harness.js
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),sharp=require('sharp');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
THREE.TextureLoader.prototype.load=function(_url,ok){const t=new THREE.Texture();queueMicrotask(()=>ok(t));return t;};
function extract(src,name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let d=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error(name);}
function glb(file){let b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));return {b,j,bin:20+len+8};}
const cx={console,localStorage:{getItem:()=>null,setItem(){},length:0,key:()=>null},Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN};cx.globalThis=cx;
vm.runInNewContext(fs.readFileSync('js/core.js','utf8')+'\n'+fs.readFileSync('js/config.js','utf8')+'\n;globalThis.result=CONFIG;',cx);
const CONFIG=cx.result,T=CONFIG.tables.arena,S=T.skins.federationFinals,P=CONFIG.pitches.federation_finals;
assert(S&&P);const file=path.join(T.folder,S.glb),pitch=path.join(P.folder,P.glb);
const warnings=[],c={THREE,CONFIG,scene:new THREE.Group(),skinGroups:{},tableGroups:{},skinLoadingCbs:{},skinHasFrame:{},skinLed:{},skinRodHoles:{},skinOrder:[],glbGoalGrow:[[],[]],glbGoalWall:[[],[]],glbGoalSplit:[],rodHoleMeshes:[],console:{log(){},warn:(...x)=>warnings.push(x.join(' '))},morph:0};
c.newGLTF=()=>({load:(f,ok,_p,fail)=>{try{const b=fs.readFileSync(f);new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail);}catch(e){fail(e);}}});
c.registerArenaMorph=()=>c.morph++;
vm.createContext(c);const src=fs.readFileSync('js/models.js','utf8');
vm.runInContext(['onm','skinKey','touchSkin','rodHoleShader','registerRodHoles','registerBigGoalMeshes','applyEmissiveStrength','loadSkin'].map(n=>extract(src,n)).join('\n'),c);
(async()=>{
 for(const f of [file,pitch]){const {b,j,bin}=glb(f);for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];const m=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();assert(m.width&&m.height);}
  for(const m of j.materials||[])assert(!m.pbrMetallicRoughness?.baseColorTexture?.texCoord,'base color uses UV0');}
 await new Promise(resolve=>c.loadSkin('arena','federationFinals',resolve));
 assert.deepEqual(warnings,[]);assert(c.skinHasFrame.arena.federationFinals);assert.equal(c.morph,1);
 const root=c.skinGroups.arena.federationFinals;let bowl=0,goals=0,pbr=0;root.traverse(o=>{if(o.isMesh&&(o.name.startsWith('arena_bowl')||o.parent?.name.startsWith('arena_bowl')))bowl++;if(o.isMesh&&o.name.startsWith('goal_frame'))goals++;if(o.isMesh&&o.material&&o.material.map&&o.material.normalMap&&o.material.roughnessMap&&o.material.metalnessMap)pbr++;});
 assert(pbr>0,'table PBR texture maps loaded');
 assert(bowl&&goals===2);assert(fs.existsSync(path.join('assets',P.tex)));
 console.log('Federation Finals: GLB and pitch images decode; Three.js loads the arena, goal frames and bowl morph registration; base maps use UV0.');
})().catch(e=>{console.error(e);process.exitCode=1;});
