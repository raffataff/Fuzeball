// Derive surface response from the actual Silver Circuit pitch livery.
// The full-size color texture defines painted lines, cyan traces and hexes;
// no repeating detail map or independent wave pattern is introduced.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {P} from './pitchlib.mjs';
const file=P('assets/pitches/pitch_silver_circuit.glb');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(file);
const mat=doc.getRoot().listMaterials()[0],base=mat.getBaseColorTexture(),orm=mat.getMetallicRoughnessTexture(),normal=mat.getNormalTexture();
if(!base||!orm||!normal) throw Error('Pitch livery or surface maps missing');
const src=await sharp(Buffer.from(base.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});
const {width:w,height:h}=src.info;
const old=await sharp(Buffer.from(orm.getImage())).resize(w,h).ensureAlpha().raw().toBuffer();
const out=Buffer.from(old),n=Buffer.alloc(w*h*3);
const lum=(i)=>(src.data[i]*.2126+src.data[i+1]*.7152+src.data[i+2]*.0722);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const p=y*w+x,i=p*3,k=p*4,light=lum(i);
 // Pale painted markings and cyan circuit traces are smoother than the
 // dark satin ground; transitions follow the artwork's antialiased edges.
 const paint=Math.max(0,Math.min(1,(light-65)/80));
 const cyan=Math.max(0,Math.min(1,(src.data[i+1]-src.data[i]-12)/65))*(1-paint);
 const ground=Math.max(-4,Math.min(4,(light-21)*.20));
 out[k+1]=Math.round(199+ground-42*paint-14*cyan);
 // A very shallow response at livery edges, with no periodic ripples.
 const xl=(y*w+Math.max(0,x-1))*3,xr=(y*w+Math.min(w-1,x+1))*3;
 const yu=(Math.max(0,y-1)*w+x)*3,yd=(Math.min(h-1,y+1)*w+x)*3;
 n[i]=Math.max(120,Math.min(136,Math.round(128-(lum(xr)-lum(xl))*.035)));
 n[i+1]=Math.max(120,Math.min(136,Math.round(128-(lum(yd)-lum(yu))*.035)));n[i+2]=255;
}
orm.setImage(new Uint8Array(await sharp(out,{raw:{width:w,height:h,channels:4}}).png().toBuffer()));
normal.setImage(new Uint8Array(await sharp(n,{raw:{width:w,height:h,channels:3}}).png().toBuffer()));
mat.setNormalScale(1);
await io.write(file,doc);
console.log('Derived pitch roughness and subtle normal from Silver Circuit livery.');
