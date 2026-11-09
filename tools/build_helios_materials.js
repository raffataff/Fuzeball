'use strict';
// Run from project root. Builds authored-surface PBR maps from the original
// flat livery art, then replaces only embedded images in the existing GLB.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const dir='assets/tables/arena/helios_runners',source=path.join(dir,'source_art');
const glb='assets/tables/arena/fuzeball_table_arena_helios.glb';
fs.mkdirSync(source,{recursive:true});
const parts=['fascia','inner','stand','leg','brace'];
const clamp=x=>Math.max(0,Math.min(255,Math.round(x)));
function hash(x,y,seed){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(seed,1274126177);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,y,scale,seed){const a=x/scale,b=y/scale,i=Math.floor(a),j=Math.floor(b),u=a-i,v=b-j,ux=u*u*(3-2*u),vy=v*v*(3-2*v);return (hash(i,j,seed)*(1-ux)+hash(i+1,j,seed)*ux)*(1-vy)+(hash(i,j+1,seed)*(1-ux)+hash(i+1,j+1,seed)*ux)*vy;}
async function png(file,data,w,h){await sharp(data,{raw:{width:w,height:h,channels:3}}).png().toFile(file);}
async function build(kind,index){
 const base=path.join(dir,kind+'_basecolor.png'),original=path.join(source,kind+'_basecolor.png');if(!fs.existsSync(original))fs.copyFileSync(base,original);
 const {data,info}=await sharp(original).removeAlpha().raw().toBuffer({resolveWithObject:true}),w=info.width,h=info.height,n=w*h;
 const rough=Buffer.alloc(n*3),metal=Buffer.alloc(n*3),normal=Buffer.alloc(n*3),orm=Buffer.alloc(n*3),color=Buffer.from(data),height=new Float32Array(n);
 // Deterministic sparse, directional scratch clusters; short and elongated.
 const wear=new Float32Array(n);
 for(let k=0;k<Math.floor(w*h/19000);k++){
  let x=Math.floor(hash(k,index,11)*(w-1)),y=Math.floor(hash(k,index,13)*(h-1)),len=5+Math.floor(hash(k,index,15)*36),slope=(hash(k,index,17)-.5)*.25;
  for(let t=0;t<len;t++){let xx=(x+t)%w,yy=Math.max(0,Math.min(h-1,Math.round(y+t*slope)));let fade=Math.sin(Math.PI*t/len);wear[yy*w+xx]=Math.max(wear[yy*w+xx],fade);if(yy+1<h)wear[(yy+1)*w+xx]=Math.max(wear[(yy+1)*w+xx],fade*.35);}
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let i=y*w+x,k=i*3,r=data[k],g=data[k+1],b=data[k+2];
  let dark=Math.max(r,g,b)<85,orange=r>150&&g<160&&r>g*1.3,cream=r>175&&g>150&&b>90;
  // These are printed finishes on paint, not bare metal; only deep chips are metallic.
  let broad=noise(x,y,50,41+index)-.5, fine=noise(x,y,4,71+index)-.5, scuff=wear[i];
  let rv=(dark?102:orange?84:cream?126:110)+broad*29+fine*14+scuff*68;
  let chip=scuff>.78&&hash(x,y,93+index)>.36;
  let mv=chip?185:0;
  if(chip){let q=100+Math.round(noise(x,y,9,31)*45);color[k]=q;color[k+1]=q;color[k+2]=q-4;}
  rv=clamp(rv);for(let c=0;c<3;c++){rough[k+c]=rv;metal[k+c]=mv;}orm[k]=255;orm[k+1]=rv;orm[k+2]=mv;
  height[i]=(dark?.35:orange?.53:cream?.44:.48)+broad*.085+fine*.045-scuff*.26;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let i=y*w+x,k=i*3,l=height[y*w+(x+w-1)%w],r=height[y*w+(x+1)%w],u=height[Math.max(0,y-1)*w+x],d=height[Math.min(h-1,y+1)*w+x];
  let nx=(l-r)*1.25,ny=(u-d)*1.25,nz=1,inv=1/Math.hypot(nx,ny,nz);normal[k]=clamp(127.5+nx*inv*127.5);normal[k+1]=clamp(127.5+ny*inv*127.5);normal[k+2]=clamp(127.5+nz*inv*127.5);
 }
 await Promise.all([png(base,color,w,h),png(path.join(dir,kind+'_roughness.png'),rough,w,h),png(path.join(dir,kind+'_metallic.png'),metal,w,h),png(path.join(dir,kind+'_normal.png'),normal,w,h),png(path.join(dir,kind+'_orm.png'),orm,w,h)]);
 console.log(kind,w,h,'updated');
}
function patchGlb(){
 const original=path.join(source,'helios-original.glb');if(!fs.existsSync(original))fs.copyFileSync(glb,original);
 const b=fs.readFileSync(original),jl=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+jl).toString()),binStart=20+jl+8,old=b.subarray(binStart,binStart+j.buffers[0].byteLength),chunks=[];let offset=0;
 const replacement=new Map();for(const img of j.images||[]){if(parts.some(p=>img.name===p+'_basecolor'||img.name===p+'_normal'||img.name===p+'_orm'))replacement.set(img.bufferView,fs.readFileSync(path.join(dir,img.name+'.png')));}
 for(let i=0;i<j.bufferViews.length;i++){
  const view=j.bufferViews[i],bytes=replacement.get(i)||old.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
  let pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}view.byteOffset=offset;view.byteLength=bytes.length;chunks.push(bytes);offset+=bytes.length;
 }
 j.buffers[0].byteLength=offset;const raw=Buffer.from(JSON.stringify(j));const jp=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);let bin=Buffer.concat(chunks);bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);let out=Buffer.alloc(12+8+jp.length+8+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jp.length,12);out.write('JSON',16);jp.copy(out,20);let pos=20+jp.length;out.writeUInt32LE(bin.length,pos);out.write('BIN\0',pos+4);bin.copy(out,pos+8);fs.writeFileSync(glb,out);
}
(async()=>{for(let i=0;i<parts.length;i++)await build(parts[i],i);patchGlb();console.log('Updated embedded GLB maps');})().catch(e=>{console.error(e);process.exitCode=1});
