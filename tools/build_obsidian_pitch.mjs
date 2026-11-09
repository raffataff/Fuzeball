// Pack the image-authored Obsidian Volt livery and material maps into the pitch GLB.
import { W, H, P, sharp, writePitch } from './pitchlib.mjs';

const src=P('assets/pitches/obsidian_volt');
const image=async(name,mono=false)=>{
 let pipe=sharp(`${src}/${name}.png`).resize(W,H,{fit:'fill'}).removeAlpha();
 if(mono)pipe=pipe.greyscale();
 return (await pipe.raw().toBuffer({resolveWithObject:true})).data;
};
const [a,height,roughness,metallic]=await Promise.all([
 image('livery'),image('height',true),image('roughness',true),image('metallic',true)
]);
const n=Buffer.alloc(W*H*3), m=Buffer.alloc(W*H*3);
for(let y=0;y<H;y++) for(let x=0;x<W;x++){
 const i=y*W+x, k=i*3;
 // Convert the supplied height image into an OpenGL tangent-space normal map.
 const dx=(height[y*W+Math.min(W-1,x+1)]-height[y*W+Math.max(0,x-1)])/255;
 const dy=(height[Math.min(H-1,y+1)*W+x]-height[Math.max(0,y-1)*W+x])/255;
 const nx=-dx*1.4, ny=dy*1.4, length=Math.hypot(nx,ny,1);
 n[k]=Math.round((nx/length*.5+.5)*255);n[k+1]=Math.round((ny/length*.5+.5)*255);n[k+2]=Math.round((1/length*.5+.5)*255);
 m[k]=255;m[k+1]=roughness[i];m[k+2]=metallic[i];
}
await Promise.all([
 sharp(n,{raw:{width:W,height:H,channels:3}}).png().toFile(`${src}/normal.png`),
 sharp(m,{raw:{width:W,height:H,channels:3}}).png().toFile(`${src}/metallic_roughness.png`)
]);
await writePitch('obsidian_volt',a,n,m,.08);
