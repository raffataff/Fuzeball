// Add tactile microfinish to the Silver Circuit skin while preserving its artwork.
// Run after exporting the skin: node tools/texture_silver_circuit.cjs
const {NodeIO}=require('@gltf-transform/core');
const sharp=require('sharp');
const {KHRMaterialsEmissiveStrength}=require('@gltf-transform/extensions');
const path=require('path');
const file=path.resolve(__dirname,'../assets/tables/circuit/fuzeball_table_circuit_silver.glb');
(async()=>{
 const io=new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]),doc=await io.read(file),root=doc.getRoot();
 if(root.listTextures().some(t=>t.getName().includes(' | tactile normal'))) throw Error('Skin already enhanced; rebuild the base model before running again.');
 const materials=root.listMaterials().filter(m=>m.getName().startsWith('Silver Circuit |')&&!m.getName().includes('halo'));
 // The two frame materials can share textures: process each material independently.
 for(const mat of materials){
  const name=mat.getName(),metal=/rail|rim|collar|stand/i.test(name);
  // Wall panels already have purpose-made engraved maps. Avoid adding a
  // regular repeated microfinish over the broad visible wall surfaces.
  if (/inner wall circuitry|goal wall engraving|goal end panel|composed side panel/i.test(name)) continue;
  const strength=/brushed silver rail/i.test(name)?0.25:1;
  for(const kind of ['normal','rough']){
   const old=kind==='normal'?mat.getNormalTexture():mat.getMetallicRoughnessTexture();
   let w=512,h=512,data;
   if(old){const decoded=await sharp(Buffer.from(old.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject:true});w=decoded.info.width;h=decoded.info.height;data=decoded.data;}
   else {data=Buffer.alloc(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=kind==='normal'?128:255;data[i+1]=kind==='normal'?128:255;data[i+2]=255;data[i+3]=255;}}
   for(let y=0;y<h;y++){
    // Parallel hairlines with broad variation remain visible at game scale.
    const line=Math.sin(y*.53)+.55*Math.sin(y*1.71)+.35*Math.sin(y*.12);
    const wave=Math.sin(y*.041)+.4*Math.sin(y*.13);
    for(let x=0;x<w;x++){
     const i=(y*w+x)*4,grain=Math.sin(x*.17+y*.31)*Math.sin(x*.047-y*.071);
     if(kind==='normal'){
      data[i]=Math.max(0,Math.min(255,Math.round(128+(data[i]-128)*(1+0.45*strength)+grain*3*strength)));
      data[i+1]=Math.max(0,Math.min(255,Math.round(128+(data[i+1]-128)*(1+0.45*strength)+(line*(metal?11:7)+grain*3)*strength)));
     }else{
      // For untextured materials the factor supplies the baseline; textured
      // materials retain their existing engraved roughness and metallic values.
      const variation=(line*7+wave*8+grain*4)*(metal?1:0.7)*strength;
      data[i+1]=Math.max(20,Math.min(255,Math.round(data[i+1]+variation-(old?0:25))));
     }
    }
   }
   const png=await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer();
   const tex=doc.createTexture(name+' | tactile '+kind).setMimeType('image/png').setImage(png);
   if(kind==='normal'){mat.setNormalTexture(tex);mat.setNormalScale(1);}else mat.setMetallicRoughnessTexture(tex);
  }
 }
 await io.write(file,doc);
 console.log('Enhanced surface response for',materials.length,'Silver Circuit materials.');
})().catch(e=>{console.error(e);process.exitCode=1});
