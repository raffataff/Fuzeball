// Federation Finals: woven green cloth, bronze-gold detailing and a subtle
// centre medallion, kept beneath crisp, regulation football markings.
import { W,H,L,WD,PPU,clamp,hash,vnoise,sstep,lineDist,spot,writePitch } from './pitchlib.mjs';
const a=Buffer.alloc(W*H*3), n=Buffer.alloc(W*H*3), m=Buffer.alloc(W*H*3);
const stroke=(d,w=.07)=>1-sstep(w,w+.10,Math.abs(d));
function leaf(x,z,cx,cz,angle){
 const dx=x-cx,dz=z-cz,cs=Math.cos(angle),sn=Math.sin(angle);
 const u=dx*cs+dz*sn,v=-dx*sn+dz*cs;
 return 1-sstep(.80,1,Math.hypot(u/1.05,v/.35));
}
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
 const k=(j*W+i)*3, x=-L/2+(i+.5)/PPU, z=-WD/2+(j+.5)/PPU;
 const g=hash(i,j), cloud=vnoise(i/105,j/105), fine=Math.sin(i*.68)*Math.sin(j*.59);
 // Cross-woven fibres with larger irregular felt flecks and faint direction
 // changes between broad bands; details remain quiet around the ball.
 const fleck=vnoise(i/8,j/5), mottling=vnoise(i/37,j/24);
 const warp=Math.pow(Math.max(0,Math.cos(i*.43+Math.sin(j*.014)*.38)),8);
 const weft=Math.pow(Math.max(0,Math.cos(j*.48+Math.sin(i*.012)*.4)),8);
 const line=Math.max(1-sstep(.045,.13,lineDist(x,z)),1-sstep(0,.12,spot(x,z)));
 const r=Math.hypot(x,z), ax=Math.abs(x), az=Math.abs(z);
 // Understated emblem: nested rings and a laurel wreath in the centre circle.
 let crest=Math.max(stroke(r-7.8,.05),stroke(r-7.5,.035))*.28;
 for(let s of [-1,1]) for(let q=0;q<6;q++){
   const t=-1.08+q*.34, cx=s*(3.8+1.7*Math.cos(t)),cz=4.5*Math.sin(t);
   crest=Math.max(crest,leaf(x,z,cx,cz,s*(.45-t*.55))*.16);
 }
 // Diamond and crown-like bars make a distinctive Federation seal without
 // placing text beneath the ball or player feet.
 const diamond=Math.abs(x)/2.1+Math.abs(z)/2.5;
 crest=Math.max(crest,stroke(diamond-1,.025)*.32);
 const bars=(az<.065 && ax<1.5)||(Math.abs(az-1.25)<.06&&ax<.85);
 if(bars) crest=Math.max(crest,.22);
 // Fine double perimeter and restrained ceremonial corner diamonds.
 let trim=0;
 if(ax<55.8&&az<30.9){
  const d=Math.min(Math.abs(az-30),Math.abs(ax-55));
  trim=Math.max(stroke(d,.035),stroke(d-.40,.025))*.55;
 }
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const d=Math.abs(x-sx*51)/1.3+Math.abs(z-sz*27)/1.1;
  trim=Math.max(trim,stroke(d-1,.035)*.65);
 }
 const fabric=.96+.13*(cloud-.5)+.14*(mottling-.5)+.10*(fleck-.5)+.07*(g-.5)+.035*fine+.035*(warp-weft);
 const panels=1+.085*Math.cos(x*Math.PI/15);
 const accent=Math.min(.8,Math.max(crest,trim));
 for(let c=0;c<3;c++){
  const base=[25,60,53][c]*fabric*panels;
  const decorated=base*(1-accent)+[171,143,82][c]*accent;
  const paint=[220,204,169][c]*(.94+.06*g);
  a[k+c]=clamp(Math.round(decorated*(1-line)+paint*line),0,255);
 }
 n[k]=clamp(Math.round(128+3.2*Math.cos(i*.68)*Math.sin(j*.59)+(warp-.2)*2),0,255);
 n[k+1]=clamp(Math.round(128+3.2*Math.sin(i*.68)*Math.cos(j*.59)+(weft-.2)*2),0,255);n[k+2]=255;
 m[k]=255;m[k+1]=Math.round((194+20*g+10*fleck)*(1-line)+178*line);m[k+2]=Math.round(accent*95);
}
await writePitch('federation_finals',a,n,m,.015);
