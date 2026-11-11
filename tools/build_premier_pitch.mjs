// Premier Championship pitch: image-derived synthetic turf and crown with
// textured markings and inlaid championship-colour corner accents.
// Run from repo root: node tools/build_premier_pitch.mjs
import {W,H,L,WD,PPU,clamp,sstep,lineDist,spot,writePitch,sharp,P} from './pitchlib.mjs';
const source=P('assets/pitches/source/premier_championship/turf.png');
const stencil=P('assets/pitches/source/premier_championship/crown-mask.png');
const raw=await sharp(source).resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer();
// Crown tips point toward -Z (one long side), not toward either X-axis goal.
const cw=Math.round(21*PPU),ch=Math.round(14*PPU);
const crown=await sharp(stencil).resize(cw,ch,{fit:'fill'}).greyscale().raw().toBuffer();
const A=Buffer.alloc(W*H*3),N=Buffer.alloc(W*H*3),M=Buffer.alloc(W*H*3);
const lum=(i,j)=>{i=clamp(i,0,W-1);j=clamp(j,0,H-1);const k=(j*W+i)*3;return (.2126*raw[k]+.7152*raw[k+1]+.0722*raw[k+2])/255;};
const stroke=(distance,half,aa=.10)=>1-sstep(half,half+aa,Math.abs(distance));
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3,x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU,light=lum(i,j);
 const ci=Math.floor(i-(W-cw)/2),cj=Math.floor(j-(H-ch)/2);
 let mark=ci>=0&&ci<cw&&cj>=0&&cj<ch?crown[cj*cw+ci]/255:0;
 // Subdued woven crest blends with each fibre rather than covering its texture.
 mark*=.43;
 const ax=Math.abs(x),az=Math.abs(z);
 // Elegant burgundy corner inlays with a double gold fillet. Keep them inside
 // the touchline, and continue the turf texture through every coloured decal.
 let burgundy=0,gold=0;
 const qx=L/2-.8-ax,qz=WD/2-.8-az;
 if(qx>=0&&qz>=0&&qx<13&&qz<8){
  const diag=qx/13+qz/8;
  if(diag<.95&&diag>.30)burgundy=.80;
  gold=Math.max(stroke(diag-.30,.012,.014),stroke(diag-.95,.012,.014))*.8;
 }
 const line=Math.max(1-sstep(.18,.27,lineDist(x,z)),1-sstep(.0,.14,spot(x,z)));
 const fibre=.70+.55*light;
 for(let c=0;c<3;c++){
  let color=raw[k+c];
  color=color*(1-mark)+[132,135,67][c]*fibre*mark;
  color=color*(1-burgundy)+[87,24,35][c]*fibre*burgundy;
  color=color*(1-gold)+[182,146,76][c]*fibre*gold;
  color=color*(1-line)+[230,224,196][c]*(.80+.38*light)*line;
  A[k+c]=clamp(Math.round(color),0,255);
 }
 // Micro-relief comes from the image's fibres, and roughness follows the
 // same image. Synthetic grass stays non-metallic, including printed decals.
 const dx=(lum(i+1,j)-lum(i-1,j))*2.3,dy=(lum(i,j+1)-lum(i,j-1))*2.3;
 const len=Math.hypot(dx,dy,1);N[k]=Math.round((.5-.5*dx/len)*255);N[k+1]=Math.round((.5+.5*dy/len)*255);N[k+2]=Math.round((.5+.5/len)*255);
 M[k]=255;M[k+1]=Math.round(clamp(.69+.22*(1-light)-.07*line-.05*gold,0,1)*255);M[k+2]=0;
}
await writePitch('premier_championship',A,N,M,.015);
