// Build aligned albedo, normal, roughness and lava emission maps from the
// generated mantle artwork. The football markings are painted over the rock.
import { W,H,L,WD,PPU,clamp,sstep,lineDist,spot,writePitch,sharp,P } from './pitchlib.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength, KHRMaterialsIOR } from '@gltf-transform/extensions';

const source=await sharp(P('assets/pitches/source/solar_forge.png')).resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer();
const heat=Buffer.alloc(W*H), rock=Buffer.alloc(W*H);
for(let q=0;q<heat.length;q++){
  const r=source[q*3],g=source[q*3+1],b=source[q*3+2];
  heat[q]=Math.round(255*sstep(5,75,r-g*.8-b*.2));
  rock[q]=Math.round(r*.21+g*.72+b*.07);
}
const grayscale=b=>sharp(b,{raw:{width:W,height:H,channels:1}});
const pixels=img=>img.toColourspace('b-w').raw().toBuffer();
const [core, shoulder, heatHalo, stone, stoneMass]=await Promise.all([
  pixels(grayscale(heat).erode(1).blur(.8)),
  pixels(grayscale(heat).erode(4).blur(2.3)),
  pixels(grayscale(heat).erode(7).blur(5)),
  pixels(grayscale(rock).blur(1.3)),
  pixels(grayscale(rock).blur(6))
]);
const a=Buffer.alloc(W*H*3), n=Buffer.alloc(W*H*3), orm=Buffer.alloc(W*H*3), em=Buffer.alloc(W*H*3);
const height=new Float32Array(W*H);
const ash=[3,4,5], hotRim=[57,13,2], lava=[174,68,10], markings=[235,173,81];
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
  const q=j*W+i,k=q*3;
  const molten=sstep(.02,.88,core[q]/255), slope=sstep(.015,.92,shoulder[q]/255);
  const halo=heatHalo[q]/255;
  // Give the broad crack shoulders and small basalt ridges separate relief scales.
  height[q]=(stoneMass[q]*.60+(stone[q]-stoneMass[q])*1.24+(rock[q]-stone[q])*.20)/255-slope*.44-molten*.18;
  const x=-L/2+(i+.5)/PPU,z=-WD/2+(j+.5)/PPU;
  const ink=Math.max(1-sstep(.035,.12,lineDist(x,z)),1-sstep(0,.11,spot(x,z)));
  for(let c=0;c<3;c++){
    const shaded=(rock[q]*.43+ash[c])*(1-slope*.67)+halo*hotRim[c]+molten*lava[c];
    a[k+c]=Math.round(clamp(shaded*(1-ink)+markings[c]*ink,0,255));
  }
  const glow=molten*(1-ink*.91);
  em[k]=Math.round(245*Math.pow(glow,.68));
  em[k+1]=Math.round(155*Math.pow(glow,1.85));
  em[k+2]=Math.round(42*Math.pow(glow,3));
  orm[k]=Math.round(255-slope*123);
  orm[k+1]=Math.round(clamp(244-stone[q]*.32-molten*152-ink*61,55,249));
  orm[k+2]=Math.round(5+molten*19+ink*47);
}
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
  const k=(j*W+i)*3,x0=Math.max(0,i-1),x1=Math.min(W-1,i+1),y0=Math.max(0,j-1),y1=Math.min(H-1,j+1);
  const dx=(height[j*W+x0]-height[j*W+x1])*7,dy=(height[y1*W+i]-height[y0*W+i])*7;
  const len=Math.hypot(dx,dy,1); n[k]=Math.round(127.5+127.5*dx/len);n[k+1]=Math.round(127.5+127.5*dy/len);n[k+2]=Math.round(127.5+127.5/len);
}
await writePitch('solar_forge',a,n,orm,0);
const file=P('assets/pitches/pitch_solar_forge.glb'),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(file);
const tex=doc.createTexture('solar_forge_emissive').setImage(new Uint8Array(await sharp(em,{raw:{width:W,height:H,channels:3}}).png().toBuffer())).setMimeType('image/png');
const material=doc.getRoot().listMaterials()[0];
const strength=doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(1.75);
const ior=doc.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.29);
material.setOcclusionTexture(material.getMetallicRoughnessTexture()).setOcclusionStrength(.75)
  .setEmissiveTexture(tex).setEmissiveFactor([1,1,1]).setExtension('KHR_materials_emissive_strength',strength)
  .setExtension('KHR_materials_ior',ior);

// The shared pitch slab projects U along +X and V along +Z. Explicit tangents
// let the r128 loader orient the normal map's green channel toward the image top.
const slab=doc.getRoot().listMeshes()[0].listPrimitives()[0];
const normals=slab.getAttribute('NORMAL');
const tangents=new Float32Array(normals.getCount()*4);
const normal=[0,0,0];
for(let i=0;i<normals.getCount();i++){
  normals.getElement(i,normal);
  tangents.set(Math.abs(normal[0])>.5?[0,1,0,normal[0]]:[1,0,0,normal[1]>.5?-1:1],i*4);
}
slab.setAttribute('TANGENT',doc.createAccessor().setType('VEC4').setArray(tangents).setBuffer(normals.getBuffer()));
await io.write(file,doc);
