// Build aligned albedo, normal, roughness and lava emission maps from the
// generated mantle artwork. The football markings are painted over the rock.
import { W,H,L,WD,PPU,clamp,sstep,lineDist,spot,writePitch,sharp,P } from './pitchlib.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const source=await sharp(P('assets/pitches/source/solar_forge.png')).resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer();
const a=Buffer.alloc(W*H*3), n=Buffer.alloc(W*H*3), orm=Buffer.alloc(W*H*3), em=Buffer.alloc(W*H*3);
const height=new Float32Array(W*H);
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
  const q=j*W+i,k=q*3, r=source[k],g=source[k+1],b=source[k+2];
  const lava=clamp((r-g*1.25-8)/100,0,1);
  const rock=(r*.22+g*.71+b*.07)/255;
  // Lava fissures are recessed; rock brightness supplies the smaller grain.
  height[q]=rock*.9-lava*.65;
  const x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU;
  const ink=Math.max(1-sstep(.035,.12,lineDist(x,z)),1-sstep(0,.11,spot(x,z)));
  for(let c=0;c<3;c++){
    const quietRock=source[k+c]*.62+[10,10,11][c];
    a[k+c]=Math.round(quietRock*(1-ink)+[230,164,72][c]*ink);
    em[k+c]=Math.round(clamp(lava*[160,45,4][c]+ink*[42,20,2][c],0,255));
  }
  orm[k]=255;orm[k+1]=Math.round(210-lava*55-ink*40);orm[k+2]=Math.round(8+ink*95);
}
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
  const k=(j*W+i)*3,x0=Math.max(0,i-1),x1=Math.min(W-1,i+1),y0=Math.max(0,j-1),y1=Math.min(H-1,j+1);
  const dx=(height[j*W+x0]-height[j*W+x1])*4,dy=(height[y0*W+i]-height[y1*W+i])*4;
  const len=Math.hypot(dx,dy,1); n[k]=Math.round(127.5+127.5*dx/len);n[k+1]=Math.round(127.5+127.5*dy/len);n[k+2]=Math.round(127.5+127.5/len);
}
await writePitch('solar_forge',a,n,orm,0);
const file=P('assets/pitches/pitch_solar_forge.glb'),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(file);
const tex=doc.createTexture('solar_forge_emissive').setImage(new Uint8Array(await sharp(em,{raw:{width:W,height:H,channels:3}}).png().toBuffer())).setMimeType('image/png');
doc.getRoot().listMaterials()[0].setEmissiveTexture(tex).setEmissiveFactor([1,1,1]);
await io.write(file,doc);
