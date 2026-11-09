import { W,H,L,WD,PPU,clamp,hash,vnoise,sstep,lineDist,spot,writePitch,sharp,P } from './pitchlib.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const a=Buffer.alloc(W*H*3),n=Buffer.alloc(W*H*3),m=Buffer.alloc(W*H*3),e=Buffer.alloc(W*H*3);
const height=new Float32Array(W*H);
function seg(x,y,x0,y0,x1,y1){const dx=x1-x0,dy=y1-y0,t=clamp(((x-x0)*dx+(y-y0)*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(x-x0-t*dx,y-y0-t*dy)}
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3,x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU,r=Math.hypot(x,z),grain=hash(i,j);
 // Restrained football markings, with the centre line replaced by the relic seal.
 let d=lineDist(x,z); if(Math.abs(x)<.25 && Math.abs(z)>10.7 && Math.abs(z)<32.5)d=99;
 const line=Math.max(1-sstep(.035,.12,d),1-sstep(0,.11,spot(x,z)));
 // A four-point astrolabe, fine orbital loops and small illuminated terminals.
 let seal=0;
 for(const rad of [3.6,6.5,10.5,15]) seal=Math.max(seal,(1-sstep(.025,.10,Math.abs(r-rad)))*(rad===15?.55:.8));
 const points=[[0,-14],[3,-3],[17,0],[3,3],[0,14],[-3,3],[-17,0],[-3,-3],[0,-14]];
 for(let p=1;p<points.length;p++) seal=Math.max(seal,1-sstep(.035,.12,seg(x,z,...points[p-1],...points[p])));
 for(let q=0;q<7;q++){
  const ang=q*Math.PI/7,xx=x*Math.cos(ang)-z*Math.sin(ang),zz=x*Math.sin(ang)+z*Math.cos(ang);
  const ellipse=Math.abs(Math.hypot(xx/1.65,zz)-3.8);seal=Math.max(seal,(1-sstep(.025,.09,ellipse))*.85);
 }
 let node=0;
 for(const [nx,nz] of [[0,0],[0,-14],[17,0],[0,14],[-17,0]]){
  const nr=Math.hypot(x-nx,z-nz); node=Math.max(node,Math.exp(-nr*nr/(nx||nz?.13:1.4)));
  seal=Math.max(seal,(1-sstep(.025,.09,Math.abs(nr-(nx||nz?.30:1.2))))*.9);
 }
 // Fine calibration ticks and pinpricks around the outer astrolabe rings.
 const theta=Math.atan2(z,x), ticks=Math.pow(Math.max(0,Math.cos(theta*36)),42);
 seal=Math.max(seal,(1-sstep(.045,.15,Math.abs(r-13.45)))*ticks*.7);
 const core=node, gold=Math.max(line*.8,seal);
 // Layered, honed dark stone: broad mineral mottling, a fine crystalline
 // grain and isolated faint purple seams. These vary independently of the ink.
 const cloud=vnoise(i/105,j/105), crystal=vnoise(i/19,j/19), micro=vnoise(i/3.3,j/3.3);
 const seam=Math.pow(Math.max(0,1-Math.abs(vnoise(i/155+j/260,j/100)-.53)*30),5);
 const fleck=Math.pow(Math.max(0,crystal*.6+micro*.4-.72),2)*12;
 const stone=.48+cloud*.68+crystal*.25+(grain-.5)*.22+fleck*.4;
 height[j*W+i]=(micro-.5)*.65+(crystal-.5)*1.5+(cloud-.5)*.5+fleck*.7-seam*.22-gold*.22;
 const base=[18,17,23],ink=[215,145,66],tint=[10,5,18];
 for(let c=0;c<3;c++){
  const ground=base[c]*stone+tint[c]*seam;
  a[k+c]=clamp(Math.round(ground*(1-gold)+ink[c]*gold+[80,38,3][c]*core),0,255);
  e[k+c]=clamp(Math.round(gold*[65,31,5][c]+core*[255,125,16][c]),0,255);
 }
 m[k]=255;m[k+1]=clamp(Math.round(142+cloud*58+crystal*27+micro*18-fleck*12-gold*75),0,255);m[k+2]=Math.round(gold*240);
}
// Finite differences of the same height field keep the normal detail aligned
// with the mineral colour and the recessed metallic inlay.
for(let j=0;j<H;j++)for(let i=0;i<W;i++){
 const k=(j*W+i)*3, x0=Math.max(0,i-1),x1=Math.min(W-1,i+1),y0=Math.max(0,j-1),y1=Math.min(H-1,j+1);
 const dx=(height[j*W+x0]-height[j*W+x1])*.30,dy=(height[y0*W+i]-height[y1*W+i])*.30,len=Math.hypot(dx,dy,1);
 n[k]=Math.round(127.5+127.5*dx/len);n[k+1]=Math.round(127.5+127.5*dy/len);n[k+2]=Math.round(127.5+127.5/len);
}
await writePitch('synaptic_relic',a,n,m,.04);
const path=P('assets/pitches/pitch_synaptic_relic.glb'),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(path);
const em=doc.createTexture('synaptic_relic_emissive').setImage(new Uint8Array(await sharp(e,{raw:{width:W,height:H,channels:3}}).png().toBuffer())).setMimeType('image/png');
doc.getRoot().listMaterials()[0].setEmissiveTexture(em).setEmissiveFactor([.65,.55,.4]);await io.write(path,doc);
