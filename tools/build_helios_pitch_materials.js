'use strict';
// Build the Helios playing-surface maps from the original pitch artwork.
// Run from the project root. Keep the original art and GLB for repeatability.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const dir='assets/pitches/source/helios_runners',source=path.join(dir,'original');
const glb='assets/pitches/pitch_helios_runners.glb';fs.mkdirSync(source,{recursive:true});
const clamp=x=>Math.max(0,Math.min(255,Math.round(x)));
function hash(x,y,s){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,1274126177);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,y,scale,seed){let a=x/scale,b=y/scale,i=Math.floor(a),j=Math.floor(b),u=a-i,v=b-j;u=u*u*(3-2*u);v=v*v*(3-2*v);return (hash(i,j,seed)*(1-u)+hash(i+1,j,seed)*u)*(1-v)+(hash(i,j+1,seed)*(1-u)+hash(i+1,j+1,seed)*u)*v;}
async function png(file,data,w,h){await sharp(data,{raw:{width:w,height:h,channels:3}}).png().toFile(file);}
async function run(){
 const art=path.join(dir,'basecolor.png'),original=path.join(source,'basecolor.png');if(!fs.existsSync(original))fs.copyFileSync(art,original);
 const {data,info}=await sharp(original).removeAlpha().raw().toBuffer({resolveWithObject:true});const w=info.width,h=info.height,n=w*h;
 const rough=Buffer.alloc(n*3),metal=Buffer.alloc(n*3),normal=Buffer.alloc(n*3),orm=Buffer.alloc(n*3),color=Buffer.from(data),height=new Float32Array(n),wear=new Float32Array(n);
 // Thin swept abrasion marks: denser in the central playing lanes.
 for(let k=0;k<1050;k++){
  let x=Math.floor(hash(k,7,21)*w),y=Math.floor((.12+.76*hash(k,8,31))*h),len=6+Math.floor(hash(k,9,41)*65),slope=(hash(k,2,51)-.5)*.55;
  for(let t=0;t<len;t++){let xx=x+t,yy=Math.round(y+t*slope);if(xx>=w||yy<0||yy>=h)break;let v=Math.sin(Math.PI*t/len);let i=yy*w+xx;wear[i]=Math.max(wear[i],v);if(yy+1<h)wear[i+w]=Math.max(wear[i+w],v*.38);}
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,k=i*3,r=data[k],g=data[k+1],b=data[k+2];
  // Anti-aliased linework and the orange emblem sit very slightly proud of the floor.
  const printed=Math.max(0,Math.min(1,(Math.max(r,g,b)-45)/120));
  const broad=noise(x,y,75,13)-.5,grain=noise(x,y,5,19)-.5,fine=noise(x,y,2,23)-.5,scuff=wear[i];
  const rv=clamp(125+printed*34+broad*30+grain*16+scuff*45),mv=0;
  for(let c=0;c<3;c++){rough[k+c]=rv;metal[k+c]=mv;}orm[k]=255;orm[k+1]=rv;orm[k+2]=mv;
  // Marks lighten the black polymer very slightly; retain the readable field art.
  if(scuff>.25){const delta=scuff*(1-printed*.65)*8;for(let c=0;c<3;c++)color[k+c]=clamp(data[k+c]+delta);}
  height[i]=.42+printed*.20+broad*.09+grain*.13+fine*.035-scuff*.18;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let i=y*w+x,k=i*3,l=height[y*w+Math.max(0,x-1)],r=height[y*w+Math.min(w-1,x+1)],u=height[Math.max(0,y-1)*w+x],d=height[Math.min(h-1,y+1)*w+x];
  let nx=(l-r)*2.0,ny=(u-d)*2.0,inv=1/Math.hypot(nx,ny,1);normal[k]=clamp(127.5+nx*inv*127.5);normal[k+1]=clamp(127.5+ny*inv*127.5);normal[k+2]=clamp(127.5+inv*127.5);
 }
 await Promise.all([png(art,color,w,h),png(path.join(dir,'roughness.png'),rough,w,h),png(path.join(dir,'metallic.png'),metal,w,h),png(path.join(dir,'normal.png'),normal,w,h),png(path.join(dir,'orm.png'),orm,w,h),sharp(color,{raw:{width:w,height:h,channels:3}}).jpeg({quality:92}).toFile('assets/pitches/helios_runners.jpeg')]);
 const oldGlb=path.join(source,'pitch-original.glb');if(!fs.existsSync(oldGlb))fs.copyFileSync(glb,oldGlb);
 const b=fs.readFileSync(oldGlb),jl=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+jl).toString()),start=20+jl+8,old=b.subarray(start,start+j.buffers[0].byteLength),repl=new Map();
 for(const im of j.images||[])if(['basecolor','normal','orm'].includes(im.name))repl.set(im.bufferView,fs.readFileSync(path.join(dir,im.name+'.png')));
 const chunks=[];let off=0;for(let i=0;i<j.bufferViews.length;i++){const v=j.bufferViews[i],bytes=repl.get(i)||old.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),pad=(4-off%4)%4;if(pad){chunks.push(Buffer.alloc(pad));off+=pad;}v.byteOffset=off;v.byteLength=bytes.length;chunks.push(bytes);off+=bytes.length;}
 j.buffers[0].byteLength=off;for(const m of j.materials||[])if(m.normalTexture)m.normalTexture.scale=.8;
 let raw=Buffer.from(JSON.stringify(j)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),bin=Buffer.concat(chunks);bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
 let out=Buffer.alloc(28+json.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.write('JSON',16);json.copy(out,20);let pos=20+json.length;out.writeUInt32LE(bin.length,pos);out.write('BIN\0',pos+4);bin.copy(out,pos+8);fs.writeFileSync(glb,out);
 console.log('Updated Helios pitch maps and embedded GLB:',w,'x',h,'normal strength 0.8');
}
run().catch(e=>{console.error(e);process.exitCode=1});
