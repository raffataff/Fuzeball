// Derive aligned OpenGL normal and lava-emission maps from the generated grip art.
import { sharp, P, clamp } from './pitchlib.mjs';
const dir='assets/tables/circuit/solar_forge/handle';
const {data,info}=await sharp(P(dir,'grip_basecolor.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
const {width:w,height:h}=info, heights=new Float32Array(w*h), normal=Buffer.alloc(w*h*3), emissive=Buffer.alloc(w*h*3);
for(let i=0;i<w*h;i++){
 const k=i*3,r=data[k],g=data[k+1],b=data[k+2],lava=clamp((r-g*1.25-8)/130,0,1);
 heights[i]=(r*.22+g*.71+b*.07)/255-lava*.6;
 emissive[k]=Math.round(lava*255);emissive[k+1]=Math.round(lava*70);emissive[k+2]=Math.round(lava*5);
}
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const k=(y*w+x)*3,dx=(heights[y*w+Math.max(0,x-1)]-heights[y*w+Math.min(w-1,x+1)])*4,
       dy=(heights[Math.max(0,y-1)*w+x]-heights[Math.min(h-1,y+1)*w+x])*4,len=Math.hypot(dx,dy,1);
 normal[k]=Math.round(127.5+127.5*dx/len);normal[k+1]=Math.round(127.5+127.5*dy/len);normal[k+2]=Math.round(127.5+127.5/len);
}
for(const [name,buf] of [['grip_normal.png',normal],['grip_emissive.png',emissive]])
 await sharp(buf,{raw:{width:w,height:h,channels:3}}).png().toFile(P(dir,name));
