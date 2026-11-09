import { L,WD,W,H,PPU,clamp,sstep,hash,vnoise,lineDist,spot,writePitch,sharp,P } from './pitchlib.mjs';
const src=await sharp(P('assets/pitches/source/alien_tech_surface.png')).resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer();
const a=Buffer.alloc(W*H*3),n=Buffer.alloc(W*H*3),m=Buffer.alloc(W*H*3);
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3,x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU,grain=hash(i,j),broad=vnoise(i/170,j/120);
 const line=Math.max(1-sstep(.07,.18,lineDist(x,z)),1-sstep(0,.13,spot(x,z)));
 // Framed etched perimeter and segmented corner detailing, kept outside the central play area.
 const ax=Math.abs(x),az=Math.abs(z);
 const rim=(1-sstep(.04,.14,Math.min(Math.abs(az-30.7),Math.abs(ax-56.5))))*(ax>48||az>25?1:0);
 const dash=(Math.sin(ax*1.85+az*.45)>.36?1:0)*rim;
 const wash=1.15+.17*broad+.08*(grain-.5);
 for(let c=0;c<3;c++){
  let ground=src[k+c]*wash+[4,8,2][c];
  ground=ground*(1-dash*.48)+[72,103,36][c]*dash*.48;
  const paint=[145,169,95][c]*(.87+.13*grain);
  a[k+c]=clamp(Math.round(ground*(1-line)+paint*line),0,255);
 }
 n[k]=clamp(Math.round(128+(src[k]-src[Math.max(0,k-3)])*.11),0,255);
 n[k+1]=clamp(Math.round(128+(src[k]-src[Math.max(0,k-W*3)])*.11),0,255);n[k+2]=255;
 m[k]=255;m[k+1]=Math.round(195+12*grain);m[k+2]=Math.round(12+18*line);
}
await writePitch('alien_tech',a,n,m,.05);
