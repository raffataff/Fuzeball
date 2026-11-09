'use strict';
// Verify all registered arena skins through the real bowl morph code.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
THREE.TextureLoader.prototype.load=function(_u,ok){const t=new THREE.Texture();queueMicrotask(()=>ok(t));return t;};
const src=fs.readFileSync('js/arena.js','utf8');
function extract(n){let a=src.indexOf('function '+n+'('),s=src.indexOf('{',a),d=1,i=s+1;assert(a>=0);while(d){if(src[i]==='{')d++;if(src[i]==='}')d--;i++;}return src.slice(a,i);}
// The Standard skin uses KTX2. Strip texture references in memory only, so
// Node can inspect the unmodified positions and normals without a GPU decoder.
function geometryOnly(file){
 const b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));
 function strip(x){if(x&&typeof x==='object')for(const k of Object.keys(x)){if(k.endsWith('Texture'))delete x[k];else strip(x[k]);}}
 strip(j.materials);delete j.textures;delete j.images;
 for(const key of ['extensionsUsed','extensionsRequired'])if(j[key])j[key]=j[key].filter(x=>x!=='KHR_texture_basisu');
 let t=Buffer.from(JSON.stringify(j)),pad=(4-t.length%4)%4;t=Buffer.concat([t,Buffer.alloc(pad,32)]);const tail=b.subarray(20+len),h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(20+t.length+tail.length,8);h.writeUInt32LE(t.length,12);h.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([h,t,tail]);
}
function same(a,b,label){assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)throw Error(label+' at '+i+': '+a[i]+' vs '+b[i]);}
function decoded(n){const a=n.array||(n.data&&n.data.array);let scale=1,signed=false;if(n.normalized){if(a instanceof Int8Array){scale=127;signed=true}else if(a instanceof Uint8Array)scale=255;else if(a instanceof Int16Array){scale=32767;signed=true}else if(a instanceof Uint16Array)scale=65535;}const out=new Float32Array(n.count*3),dec=v=>signed?Math.max(-1,v/scale):v/scale;for(let i=0;i<n.count;i++){out[i*3]=dec(n.getX(i));out[i*3+1]=dec(n.getY(i));out[i*3+2]=dec(n.getZ(i));}return out;}
function context(){const c={THREE,Math,Uint32Array,Float32Array,Int8Array,Uint8Array,Int16Array,Uint16Array,F:{goalHalf:11,L:120},PHY:{bigGoalMult:1.5},ARENA:{width:68,bigGoalReach:12},ARENA_ON:true,arenaMorph:[],arenaMorphDirty:false,goalFrames:[{scale:{z:1}},{scale:{z:1}}],arenaProject:(x,z)=>({x,z}),clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),onm:o=>o.name,console};vm.createContext(c);vm.runInContext(['prepareArenaNormals','arenaWeld','arenaSmoothNorm','registerArenaMorph','arenaMorphUpdate'].map(extract).join('\n'),c);return c;}
function read(file){const b=geometryOnly(file);return new Promise((resolve,reject)=>new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',resolve,reject));}
(async()=>{
 for(const [name,file] of [['Standard','fuzeball_table_arena_standard.glb'],['Federation Finals','fuzeball_table_arena_federation.glb'],['Helios Runners','fuzeball_table_arena_helios.glb']]){
  const g=await read('assets/tables/arena/'+file),c=context(),originals=[];
  g.scene.traverse(o=>{if(o.isMesh&&(o.name.startsWith('arena_bowl')||o.parent?.name.startsWith('arena_bowl'))&&o.geometry.attributes.normal)originals.push({o,n:decoded(o.geometry.attributes.normal),p:decoded(o.geometry.attributes.position)});});
  assert(originals.length,`${name}: bowl not found`);
  function outward(){let sum=0,k=0;for(const {o} of originals){const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;for(let i=0;i<p.count;i++)if(Math.abs(p.getZ(i))>34&&Math.abs(p.getX(i))<40&&p.getY(i)<7&&n.getZ(i)*Math.sign(p.getZ(i))>.25){sum+=n.getZ(i)*Math.sign(p.getZ(i));k++;}}return {mean:sum/k,count:k};}
  c.registerArenaMorph(g.scene);
  for(const {o,n} of originals)same(o.geometry.attributes.normal.array,n,`${name}: normals changed at rest`);
  c.goalFrames[1].scale.z=1.5;c.arenaMorphUpdate();
  // Compare the same outward-facing exterior vertices before and after morph.
  let before=0,after=0,count=0;
  for(const {o,n} of originals){const p=o.geometry.attributes.position,now=o.geometry.attributes.normal;for(let i=0;i<p.count;i++){const sign=Math.sign(p.getZ(i)),v=n[i*3+2]*sign;if(Math.abs(p.getZ(i))>34&&Math.abs(p.getX(i))<40&&p.getY(i)<7&&v>.5){before+=v;after+=now.getZ(i)*sign;count++;}}}
  assert(count>20,`${name}: no exterior samples`);assert(after/count>.35,`${name}: exterior normals reversed in morph`);
  c.goalFrames[1].scale.z=1;c.arenaMorphUpdate();for(const {o,n,p} of originals){same(o.geometry.attributes.normal.array,n,`${name}: rest normals not restored`);same(decoded(o.geometry.attributes.position),p,`${name}: rest positions not restored`);}
  console.log(`${name}: ${count} exterior vertices, mean outward normal ${(before/count).toFixed(3)} authored / ${(after/count).toFixed(3)} enlarged; all normals preserved and restored.`);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});

