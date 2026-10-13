'use strict';
// node tools/render-bounds.js: the y of the top of each figure in its tape render (px of 1024), per model id, ready to paste as `renderTop:` in js/config.js.
// The Kick Off kit panels crop the render from the head down (CONFIG.playerModel.portrait), so a re-rendered figurine needs its number measured again.
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const root=path.join(__dirname,'..');
function decode(file){
 const b=fs.readFileSync(file);let p=8,w=0,h=0,ct=0,bd=0;const idat=[];
 while(p<b.length){const len=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8);
  if(type==='IHDR'){w=b.readUInt32BE(p+8);h=b.readUInt32BE(p+12);bd=b[p+16];ct=b[p+17];}
  else if(type==='IDAT')idat.push(b.slice(p+8,p+8+len));
  p+=12+len;}
 if(bd!==8||ct!==6)throw new Error(file+': expected 8-bit RGBA');
 const raw=zlib.inflateSync(Buffer.concat(idat)),st=w*4,out=Buffer.alloc(h*st);
 for(let y=0;y<h;y++){
  const f=raw[y*(st+1)],s=y*(st+1)+1,d=y*st;
  for(let x=0;x<st;x++){
   const a=x>=4?out[d+x-4]:0,u=y?out[d-st+x]:0,c=(x>=4&&y)?out[d-st+x-4]:0;
   let v=raw[s+x];
   if(f===1)v+=a;else if(f===2)v+=u;else if(f===3)v+=(a+u)>>1;
   else if(f===4){const pa=Math.abs(u-c),pb=Math.abs(a-c),pc=Math.abs(a+u-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?u:c);}
   out[d+x]=v&255;}}
 return {w,h,d:out};
}
const src=fs.readFileSync(path.join(root,'js/config.js'),'utf8');
const re=/\{\s*id:\s*'([^']+)'[^}]*?mug:\s*'assets\/renders\/render_([a-z0-9]+)_mugshot\.png'/gi;
let m,n=0;
while((m=re.exec(src))){
 const f=path.join(root,'assets/renders/render_'+m[2]+'_cycles.png');
 if(!fs.existsSync(f)){console.log(m[1]+': no render');continue;}
 const {w,h,d}=decode(f);let top=-1;
 for(let y=0;y<h&&top<0;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4+3]>24){top=y;break;}
 console.log(m[1].padEnd(14)+top);n++;
}
console.log(n+' figures');
