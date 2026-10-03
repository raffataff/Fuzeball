// trophy-alpha.mjs: give the trophy renders a real alpha channel.
//      cd tools && node trophy-alpha.mjs            (needs `npm i` in tools/ once, for sharp)
// assets/renders/render_trophy_<id>_{cycles,thumb}.jpg are rendered on black (a black square on a panel; a CSS blend can't hide it once anything isolates the image), so this writes a .webp beside each .jpg with the black turned transparent, and league.js trophyImg() loads those
// alpha ramps on brightness (max of r,g,b) from LO to HI: black and its JPEG noise go clear, anything brighter than HI (the whole trophy, dark bronze included) stays solid, and the soft edge is un-premultiplied so it has no dark fringe
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const DIR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','assets','renders');
const LO=6, HI=34;
for(const f of fs.readdirSync(DIR).filter(f=>/^render_trophy_.+\.jpg$/.test(f))){
 const src=path.join(DIR,f),out=src.replace(/\.jpg$/,'.webp');
 const {data,info}=await sharp(src).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const px=Buffer.alloc(info.width*info.height*4);
 for(let i=0,o=0;i<data.length;i+=3,o+=4){
  const r=data[i],g=data[i+1],b=data[i+2],m=Math.max(r,g,b);
  const a=m<=LO?0:m>=HI?1:(m-LO)/(HI-LO);
  px[o]=a?Math.min(255,Math.round(r/a)):0;
  px[o+1]=a?Math.min(255,Math.round(g/a)):0;
  px[o+2]=a?Math.min(255,Math.round(b/a)):0;
  px[o+3]=Math.round(a*255);
 }
 await sharp(px,{raw:{width:info.width,height:info.height,channels:4}}).webp({quality:88,alphaQuality:90}).toFile(out);
 console.log(path.basename(out),info.width+'x'+info.height,fs.statSync(out).size+' bytes');
}
