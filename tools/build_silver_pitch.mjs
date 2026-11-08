import { W,H,L,WD,PPU,clamp,hash,sstep,lineDist,spot,writePitch,sharp } from './pitchlib.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsIOR } from '@gltf-transform/extensions';
import { P } from './pitchlib.mjs';
// Midnight-blue satin with crisp football markings and understated tech accents.
const a=Buffer.alloc(W*H*3), n=Buffer.alloc(W*H*3), m=Buffer.alloc(W*H*3), e=Buffer.alloc(W*H*3);
function segmentDistance(x,z,x0,z0,x1,z1){
 const dx=x1-x0,dz=z1-z0,t=clamp(((x-x0)*dx+(z-z0)*dz)/(dx*dx+dz*dz),0,1);
 return Math.hypot(x-x0-t*dx,z-z0-t*dz);
}
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
 const k=(j*W+i)*3, grain=hash(i,j), cloud=hash(Math.floor(i/13),Math.floor(j/13));
 const x=-L/2+(i+.5)/PPU, z=-WD/2+(j+.5)/PPU;
 // Soft reflected cyan light at the two posts of each goal, fading into the navy.
 let glow=0;
 for(const end of [-1,1]) for(const side of [-1,1]){
  const dx=(x-end*59)/4.2, dz=(z-side*10.6)/3.4;
  glow+=Math.exp(-2.2*(dx*dx+dz*dz));
 }
 const line=Math.max(1-sstep(.045,.16,lineDist(x,z)),1-sstep(0,.13,spot(x,z)));
 // Paired corner traces echo the cabinet's three-line engraving without
 // competing with the football markings or the men in the playing area.
 let trace=0;
 for(const end of [-1,1]) for(const side of [-1,1]) for(const off of [0,1.15]){
  const xx=x*end,zz=z*side;
  const d=Math.min(segmentDistance(xx,zz,50,29-off,54,29-off),
                   segmentDistance(xx,zz,54,29-off,56,31-off));
  trace=Math.max(trace,1-sstep(.04,.12,d));
 }
 const wash=.92+.10*grain+.035*cloud;
 for(let c=0;c<3;c++){
  const ground=[10,24,39][c]*wash+[3,38,51][c]*glow;
  const etched=ground*(1-trace)+[36,111,129][c]*trace;
  a[k+c]=clamp(Math.round(etched*(1-line)+[95,148,159][c]*line),0,255);
  e[k+c]=Math.round(Math.max(line*.55,trace*.9)*[35,112,132][c]);
 }
 // Fine microtexture rather than a perfectly flat normal.
 n[k]=clamp(Math.round(128+(hash(i+1,j)-grain)*2),0,255);
 n[k+1]=clamp(Math.round(128+(hash(i,j+1)-grain)*2),0,255);n[k+2]=255;
 // The reference is a dark satin playing surface, with broad subdued
 // highlights rather than a metallic, mirror-like sheen.
 m[k]=255;m[k+1]=Math.round((192+grain*8)*(1-line)+162*line);m[k+2]=0;
}
await writePitch('silver_circuit',a,n,m,.04);
// Keep the reduced dielectric reflection in the GLB itself for modern viewers.
// The game's older Three.js loader reads the matching registry value in config.js.
const path=P('assets/pitches/pitch_silver_circuit.glb');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), doc=await io.read(path);
const ior=doc.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.2222222);
const mat=doc.getRoot().listMaterials()[0];
mat.setExtension('KHR_materials_ior',ior);
const emPng=await sharp(e,{raw:{width:W,height:H,channels:3}}).png().toBuffer();
const em=doc.createTexture('silver_circuit_emissive').setImage(new Uint8Array(emPng)).setMimeType('image/png');
mat.setEmissiveTexture(em).setEmissiveFactor([.45,.65,.70]);
await io.write(path,doc);
