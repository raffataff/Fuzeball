// Derive aligned OpenGL normal and lava-emission maps from the generated grip art.
import { sharp, P, clamp, sstep } from './pitchlib.mjs';
const dir='assets/tables/circuit/solar_forge/handle';
const {data,info}=await sharp(P(dir,'grip_basecolor.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
const {width:w,height:h}=info, heights=new Float32Array(w*h), normal=Buffer.alloc(w*h*3), emissive=Buffer.alloc(w*h*3);
const wrap=Buffer.alloc(data.length), rowTone=new Float32Array(h);
for(let y=0;y<h;y++){
 for(let x=0;x<w;x++)rowTone[y]+=data[(y*w+x)*3+2];
 rowTone[y]/=w;
}
const average=rowTone.reduce((sum,tone)=>sum+tone,0)/h;
for(let y=0;y<h;y++){
 const opposite=h-1-y;
 const seam=.5*(1-sstep(0,h*.095,Math.min(y,opposite)));
 for(let x=0;x<w;x++){
  const k=(y*w+x)*3, other=(opposite*w+x)*3;
  for(let c=0;c<3;c++){
   const first=data[k+c]+(average-rowTone[y])*.78;
   const second=data[other+c]+(average-rowTone[opposite])*.78;
   wrap[k+c]=Math.round(clamp(first*(1-seam)+second*seam,0,255));
  }
 }
}
for(let i=0;i<w*h;i++){
 const k=i*3,r=wrap[k],g=wrap[k+1],b=wrap[k+2],lava=clamp((r-g*1.25-8)/130,0,1);
 heights[i]=(r*.22+g*.71+b*.07)/255-lava*.6;
 emissive[k]=Math.round(lava*255);emissive[k+1]=Math.round(lava*70);emissive[k+2]=Math.round(lava*5);
}
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const k=(y*w+x)*3,dx=(heights[y*w+Math.max(0,x-1)]-heights[y*w+Math.min(w-1,x+1)])*4,
       dy=(heights[((y+1)%h)*w+x]-heights[((y+h-1)%h)*w+x])*4,len=Math.hypot(dx,dy,1);
 normal[k]=Math.round(127.5+127.5*dx/len);normal[k+1]=Math.round(127.5+127.5*dy/len);normal[k+2]=Math.round(127.5+127.5/len);
}
for(const [name,buf] of [['grip_wrap.png',wrap],['grip_normal.png',normal],['grip_emissive.png',emissive]])
 await sharp(buf,{raw:{width:w,height:h,channels:3}}).png().toFile(P(dir,name));
