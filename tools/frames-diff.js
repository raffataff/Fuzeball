'use strict';
// compares two frame sets PNG by PNG (same relative paths): mean abs difference (0-255), share of pixels off by more than `tol`, and writes a x8 diff image for each frame that differs
// node tools/frames-diff.js tools/build/three-base/frames tools/build/three-s1/frames [--tol=8] [--out=dir]
const fs=require('fs'),path=require('path'),sharp=require('./node_modules/sharp');
const args=process.argv.slice(2),fl={};for(const a of args.filter(a=>a.startsWith('--'))){const [k,v]=a.slice(2).split('=');fl[k]=v===undefined?true:v;}
const [A,B]=args.filter(a=>!a.startsWith('--'));
if(!A||!B){console.error('usage: node tools/frames-diff.js <baseDir> <newDir> [--tol=8] [--out=dir]');process.exit(2);}
const tol=+(fl.tol||8),out=fl.out||path.join(B,'..','diff');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.png')?[path.join(d,e.name)]:[]);
(async()=>{
 const rows=[];
 for(const fa of walk(A)){
  const rel=path.relative(A,fa),fb=path.join(B,rel);
  if(!fs.existsSync(fb)){rows.push({rel,miss:true});continue;}
  const [a,b]=await Promise.all([fa,fb].map(f=>sharp(f).removeAlpha().raw().toBuffer({resolveWithObject:true})));
  if(a.info.width!==b.info.width||a.info.height!==b.info.height){rows.push({rel,size:true});continue;}
  const n=a.data.length/3,d=Buffer.alloc(a.data.length);let sum=0,off=0,mx=0;
  for(let i=0;i<n;i++){let m=0;for(let c=0;c<3;c++){const v=Math.abs(a.data[i*3+c]-b.data[i*3+c]);sum+=v;if(v>m)m=v;d[i*3+c]=Math.min(255,v*8);}if(m>tol)off++;if(m>mx)mx=m;}
  const r={rel,mean:sum/(n*3),off:off/n,max:mx};rows.push(r);
  if(off){const o=path.join(out,rel);fs.mkdirSync(path.dirname(o),{recursive:true});await sharp(d,{raw:{width:a.info.width,height:a.info.height,channels:3}}).png().toFile(o);}
 }
 rows.sort((x,y)=>(y.off||0)-(x.off||0));
 for(const r of rows)console.log(r.miss?'MISSING '+r.rel:r.size?'SIZE    '+r.rel:(r.mean.toFixed(2).padStart(6)+'  '+(100*r.off).toFixed(2).padStart(6)+'%  max '+String(r.max).padStart(3)+'  '+r.rel));
 const ok=rows.filter(r=>!r.miss&&!r.size);
 console.log(rows.length+' frames; mean '+(ok.reduce((s,r)=>s+r.mean,0)/Math.max(1,ok.length)).toFixed(3)+'; '+ok.filter(r=>r.off>0).length+' with pixels off by >'+tol+'; diffs in '+out);
})();
