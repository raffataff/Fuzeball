#!/usr/bin/env node
/* ================= rod-hole ring contract — checker =================
     node tools/rodholes-check.mjs                 # every table skin
     node tools/rodholes-check.mjs <file.glb> ...  # just these

   Reads a table skin GLB straight off disk and answers the only two questions that matter while
   you are doing the Blender pass:

     BEFORE  — where are this skin's rings right now? Which object holds them, which material slot
               to select, how many triangles you are about to inherit.
     AFTER   — does this export satisfy the `rod_hole*` contract registerRodHoles (js/models.js)
               will hold it to? Eight objects, one per rod, transforms applied, nothing extra
               dragged in, and — the one nobody thinks to check — no ORPHANED ring geometry left
               behind in the wall, which is what you get from a duplicate instead of a separate and
               which shows up in game as rings that never light plus z-fighting.

   Zero dependencies and it never launches the game, so it is safe to run between every export.
   Everything it knows about rod positions comes from ROD_X below, which mirrors CONFIG.rods.defs. */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROD_X=[-52.5,-37.5,-22.5,-7.5,7.5,22.5,37.5,52.5];   // CONFIG.rods.defs
const ROD_H=7.5;          // rod centre height (world.js ROD_H)
const RING_R=2.4;         // a ring's outer radius, with slack — measured 1.41..1.95 across the shipped skins
const TOL=7.5;            // half the rod spacing: past this a ring belongs to no rod
const TRI_BUDGET=400;     // per ring, above which it is worth a decimate (a ring is ~30px on screen)

const CT={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

function parseGlb(file){
 const d=fs.readFileSync(file);
 if(d.readUInt32LE(0)!==0x46546C67)throw new Error('not a GLB');
 let off=12,json=null,bin=null;
 while(off<d.length){
  const len=d.readUInt32LE(off),type=d.readUInt32LE(off+4);
  if(type===0x4E4F534A)json=JSON.parse(d.slice(off+8,off+8+len).toString('utf8'));
  else if(type===0x004E4942)bin=d.slice(off+8,off+8+len);
  off+=8+len;
 }
 return {g:json,bin};
}
/* Accessors may be interleaved (byteStride), so this reads element by element rather than casting
   the whole view — slower, and correct for every export Blender can produce. */
function readAcc(g,bin,i){
 const a=g.accessors[i];
 if(a.bufferView==null)return null;
 const bv=g.bufferViews[a.bufferView],n=NC[a.type],T=CT[a.componentType];
 const itemsz=T.BYTES_PER_ELEMENT*n,stride=bv.byteStride||itemsz;
 const base=(bv.byteOffset||0)+(a.byteOffset||0);
 const out=new (a.componentType===5126?Float32Array:Float64Array)(a.count*n);
 for(let k=0;k<a.count;k++){
  const v=new T(bin.buffer,bin.byteOffset+base+k*stride,n);
  for(let c=0;c<n;c++)out[k*n+c]=v[c];
 }
 return out;
}
/* ---- 4x4, column-major, glTF order ---- */
const IDENT=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a,b){const o=new Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;
  for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
 return o;}
function trs(n){
 if(n.matrix)return n.matrix.slice();
 const t=n.translation||[0,0,0],q=n.rotation||[0,0,0,1],s=n.scale||[1,1,1];
 const [x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z;
 const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
 return [(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,
         (xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,
         (xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,
         t[0],t[1],t[2],1];
}
const isIdent=m=>m.every((v,i)=>Math.abs(v-IDENT[i])<1e-6);
function xform(m,x,y,z){return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];}

/* Flatten the scene graph into one entry per PRIMITIVE, with its world matrix. */
function flatten(g){
 const out=[];
 const walk=(ni,parent)=>{
  const n=g.nodes[ni],m=mul(parent,trs(n));
  if(n.mesh!=null){
   const mesh=g.meshes[n.mesh];
   mesh.primitives.forEach((p,pi)=>out.push({node:n.name||('node_'+ni),prim:pi,p,m,
     mat:p.material!=null?(g.materials[p.material].name||('mat_'+p.material)):null,
     nprims:mesh.primitives.length}));
  }
  (n.children||[]).forEach(c=>walk(c,m));
 };
 const sc=g.scenes[g.scene||0];
 (sc.nodes||[]).forEach(n=>walk(n,IDENT));
 return out;
}
/* Measure one primitive against the rod grid. */
function measure(g,bin,e){
 const pos=readAcc(g,bin,e.p.attributes.POSITION);
 const idx=e.p.indices!=null?readAcc(g,bin,e.p.indices):null;
 const nv=pos.length/3;
 const counts=new Array(ROD_X.length).fill(0);
 let inRing=0,inBand=0,maxOff=0,minX=Infinity,maxX=-Infinity;
 for(let k=0;k<nv;k++){
  const [x,y]=xform(e.m,pos[k*3],pos[k*3+1],pos[k*3+2]);
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  let best=Infinity,bi=-1;
  for(let r=0;r<ROD_X.length;r++){const d=Math.abs(ROD_X[r]-x);if(d<best){best=d;bi=r;}}
  const band=Math.abs(y-ROD_H)<2.5;
  if(band&&best<RING_R){inRing++;counts[bi]++;maxOff=Math.max(maxOff,best);}
  if(band)inBand++;
 }
 const used=counts.filter(c=>c>0).length;
 const nz=counts.filter(c=>c>0);
 const even=nz.length?Math.max(...nz)/Math.min(...nz):0;
 return {nv,tris:idx?idx.length/3:0,counts,used,even,maxOff,
   ringFrac:nv?inRing/nv:0,spanX:maxX-minX,
   /* "this primitive IS the rings": essentially every vertex sits on a rod, spread over 7+ of
      them, spanning the table. Evenness is reported but NOT required — the arena's rings differ
      in size per rod, and gating on it would hide them. */
   isRings:(nv?inRing/nv:0)>0.98 && used>=7 && (maxX-minX)>90};
}

let bad=0;
function check(file){
 const rel=path.relative(ROOT,file);
 let g,bin;
 try{({g,bin}=parseGlb(file));}catch(e){console.log('\n'+rel+'\n   cannot read: '+e.message);bad++;return;}
 console.log('\n\x1b[1m'+rel+'\x1b[0m');
 if((g.extensionsRequired||[]).some(x=>/draco|meshopt/i.test(x))){
  console.log('   compressed geometry ('+g.extensionsRequired.join(', ')+') — cannot inspect positions');bad++;return;}

 const prims=flatten(g);
 const named=prims.filter(e=>/^rod_hole/i.test(e.node));

 if(!named.length){
  // ---- BEFORE: tell them what to select ----
  const cand=prims.map(e=>({e,m:measure(g,bin,e)})).filter(c=>c.m.isRings);
  if(!cand.length){console.log('   \x1b[33mno rod_hole* objects, and no ring geometry found either\x1b[0m');return;}
  console.log('   \x1b[33mnot converted yet\x1b[0m — the rings are here:');
  let tot=0;
  for(const {e,m} of cand){
   tot+=m.tris;
   console.log('     object \x1b[1m'+e.node+'\x1b[0m'+(e.nprims>1?'  (primitive '+e.prim+' of '+e.nprims+')':'')
     +'\n       material slot \x1b[1m'+e.mat+'\x1b[0m · '+m.tris.toLocaleString()+' tris · '+m.used+'/8 rods'
     +(e.nprims>1?'':'  <- already its own object; nothing to split off the wall'));
   if(m.ringFrac<0.999)console.log('       \x1b[33mnote: '+((1-m.ringFrac)*100).toFixed(1)
     +'% of this slot is NOT ring geometry — check the selection before you split\x1b[0m');
   if(m.even>1.5)console.log('       \x1b[33mnote: the rings are not all the same size here ('
     +m.even.toFixed(1)+'x between largest and smallest) — decimate per ring, not with one ratio\x1b[0m');
  }
  console.log('     total '+tot.toLocaleString()+' tris across '+cand.length+' object'+(cand.length>1?'s':'')
    +' — budget after decimate is ~'+(TRI_BUDGET*16).toLocaleString());
  return;
 }

 // ---- AFTER: hold the export to the contract ----
 const seen=new Map(); let ok=true;
 const say=(good,msg)=>{console.log('     '+(good?'\x1b[32mok  \x1b[0m':'\x1b[31mFAIL\x1b[0m')+' '+msg);if(!good)ok=false;};
 console.log('   '+named.length+' rod_hole* object'+(named.length>1?'s':'')+':');
 for(const e of named){
  const m=measure(g,bin,e);
  const cx=m.counts.reduce((a,c,i)=>c>a.c?{c,i}:a,{c:-1,i:-1}).i;
  const rods=m.counts.map((c,i)=>c>0?i:-1).filter(i=>i>=0);
  const tag=e.node+'  ';
  if(rods.length!==1){say(false,tag+'covers '+rods.length+' rods — one object per rod, holding that rod\'s near AND far ring');continue;}
  if(m.ringFrac<0.98){say(false,tag+'only '+(m.ringFrac*100).toFixed(1)+'% of its vertices sit on a rod — extra geometry came along');continue;}
  if(!isIdent(e.m)){say(false,tag+'has an unapplied transform — Ctrl+A -> All Transforms');continue;}
  if(seen.has(cx)){say(false,tag+'is on the same rod (x='+ROD_X[cx]+') as '+seen.get(cx));continue;}
  seen.set(cx,e.node);
  const heavy=m.tris>TRI_BUDGET*2;
  say(true,tag+'rod '+(cx+1)+' (x='+ROD_X[cx].toFixed(1).padStart(6)+') · '+String(m.tris).padStart(6)+' tris'
    +(heavy?'  \x1b[33m(heavy — a ring is ~30px on screen, ~'+TRI_BUDGET+' is plenty)\x1b[0m':''));
 }
 const missing=ROD_X.map((x,i)=>i).filter(i=>!seen.has(i));
 if(missing.length)say(false,'no ring for rod'+(missing.length>1?'s':'')+' '+missing.map(i=>(i+1)+' (x='+ROD_X[i]+')').join(', '));

 // the one nobody checks: rings duplicated rather than separated
 const orphan=prims.filter(e=>!/^rod_hole/i.test(e.node)).map(e=>({e,m:measure(g,bin,e)})).filter(c=>c.m.isRings);
 if(orphan.length)say(false,'ring geometry ALSO still in '+orphan.map(c=>c.e.node).join(', ')
   +' — separate (P) rather than duplicate, or you get unlit rings z-fighting the lit ones');
 else say(true,'no leftover ring geometry in the walls');

 if(!ok)bad++;
 else console.log('   \x1b[32mcontract satisfied\x1b[0m');
}

const args=process.argv.slice(2);
const files=args.length?args:fs.readdirSync(path.join(ROOT,'assets/tables'),{withFileTypes:true})
 .filter(d=>d.isDirectory())
 .flatMap(d=>fs.readdirSync(path.join(ROOT,'assets/tables',d.name))
   .filter(f=>f.endsWith('.glb')&&f.includes('table'))
   .map(f=>path.join(ROOT,'assets/tables',d.name,f)));
files.forEach(check);
console.log('\n'+files.length+' file(s) checked'+(bad?', \x1b[31m'+bad+' with problems\x1b[0m':'')+'\n');
process.exit(bad?1:0);
