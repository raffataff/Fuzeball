// Compose a long non-repeating fascia from the generated rock artwork.
import { sharp, P } from './pitchlib.mjs';
const dir='assets/tables/circuit/solar_forge';
const w=1024,h=315,overlap=240,step=w-overlap,outW=w+step*2;
const first=await sharp(P(dir,'fascia_source.png')).resize(w,h,{fit:'fill'}).removeAlpha().raw().toBuffer();
const middle=await sharp(P(dir,'pedestal_source.png')).resize(w,h,{fit:'cover'}).removeAlpha().raw().toBuffer();
const last=await sharp(P(dir,'fascia_source.png')).flop().resize(w,h,{fit:'fill'}).removeAlpha().raw().toBuffer();
const out=Buffer.alloc(outW*h*3);
for(let y=0;y<h;y++)for(let x=0;x<outW;x++){
 let weights=[0,0,0];
 for(let t=0;t<3;t++){
  const q=x-t*step;
  if(q>=0&&q<w){const fadeIn=t===0?1:Math.min(1,q/overlap),fadeOut=t===2?1:Math.min(1,(w-1-q)/overlap);weights[t]=Math.min(fadeIn,fadeOut);}
 }
 const sum=weights[0]+weights[1]+weights[2];
 for(let c=0;c<3;c++){
  let value=0; for(let t=0;t<3;t++) if(weights[t]) value+=[first,middle,last][t][(y*w+x-t*step)*3+c]*weights[t];
  out[(y*outW+x)*3+c]=Math.round(value/sum);
 }
}
await sharp(out,{raw:{width:outW,height:h,channels:3}}).png().toFile(P(dir,'fascia_long.png'));
