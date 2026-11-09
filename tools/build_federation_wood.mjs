// Derive subtle wood pore normals and satin lacquer roughness from the source.
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'assets','tables','arena','federation_finals');
const size=1024;
const {data}=await sharp(path.join(dir,'walnut_source.png')).resize(size,size).removeAlpha().raw().toBuffer({resolveWithObject:true});
const normal=Buffer.alloc(data.length),rough=Buffer.alloc(data.length);
function lum(x,y){x=Math.max(0,Math.min(size-1,x));y=Math.max(0,Math.min(size-1,y));const p=(y*size+x)*3;return data[p]*.2126+data[p+1]*.7152+data[p+2]*.0722;}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const p=(y*size+x)*3,l=lum(x,y);
 normal[p]=Math.max(0,Math.min(255,Math.round(128+(lum(x-1,y)-lum(x+1,y))*.65)));
 normal[p+1]=Math.max(0,Math.min(255,Math.round(128+(lum(x,y-1)-lum(x,y+1))*.65)));normal[p+2]=255;
 const r=Math.round(Math.max(82,Math.min(135,105+(l-55)*.28)));rough[p]=rough[p+1]=rough[p+2]=r;
}
await sharp(data,{raw:{width:size,height:size,channels:3}}).png().toFile(path.join(dir,'walnut_basecolor.png'));
await sharp(normal,{raw:{width:size,height:size,channels:3}}).png().toFile(path.join(dir,'walnut_normal.png'));
await sharp(rough,{raw:{width:size,height:size,channels:3}}).png().toFile(path.join(dir,'walnut_roughness.png'));
