// Strike pitch: racing livery drives colour, micro-relief and material response.
import {W,H,L,WD,PPU,clamp,sstep,lineDist,spot,writePitch,sharp,P} from './pitchlib.mjs';
const raw=await sharp(P('assets/pitches/source/strike/strike-surface-art.png')).resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer();
const A=Buffer.alloc(W*H*3),N=Buffer.alloc(W*H*3),M=Buffer.alloc(W*H*3);
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3,x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU;
 const d=lineDist(x,z),line=1-sstep(.13,.24,d),dot=1-sstep(.0,.15,spot(x,z));
 const paint=Math.max(line,dot),edge=(1-sstep(.30,.46,d))*(1-paint)*.5;
 // Slightly lift the graphite so the finish is visible even under game lighting.
 for(let c=0;c<3;c++){
  const v=clamp(raw[k+c]*1.03+14,0,255);const red=[130,20,24][c];
  const ground=v*(1-edge)+red*edge;
  A[k+c]=Math.round(clamp(ground*(1-paint)+[220,225,228][c]*paint,0,255));
 }
}
const light=(i,j)=>{i=clamp(i,0,W-1);j=clamp(j,0,H-1);const k=(j*W+i)*3;return (.2126*A[k]+.7152*A[k+1]+.0722*A[k+2])/255;};
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3,l=light(i,j),dx=(light(i+1,j)-light(i-1,j))*.55,dy=(light(i,j+1)-light(i,j-1))*.55,len=Math.hypot(dx,dy,1);
 N[k]=Math.round((.5-.5*dx/len)*255);N[k+1]=Math.round((.5+.5*dy/len)*255);N[k+2]=Math.round((.5+.5/len)*255);
 // Printed surface: mostly satin resin, with image-driven subtle variation.
 M[k]=255;M[k+1]=Math.round(clamp(.58-.16*l,.38,.65)*255);M[k+2]=Math.round(clamp(.08+.12*l,.08,.20)*255);
}
await writePitch('strike',A,N,M,.025);
