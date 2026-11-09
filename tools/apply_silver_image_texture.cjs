// Apply an image-generated satin aluminum finish to the top rail and stand.
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const sharp=require('sharp'),path=require('path');
const base=path.resolve(__dirname,'../assets/tables/circuit/silver_circuit/satin_aluminum_imagegen.png');
const file=path.resolve(__dirname,'../assets/tables/circuit/fuzeball_table_circuit_silver.glb');
(async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(file),root=doc.getRoot();
 const {data,info}=await sharp(base).resize(1024,1024).greyscale().raw().toBuffer({resolveWithObject:true});
 const w=info.width,h=info.height,normal=Buffer.alloc(w*h*3),rough=Buffer.alloc(w*h*3),albedo=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,i=p*3,v=data[p],dx=data[y*w+Math.min(w-1,x+1)]-data[y*w+Math.max(0,x-1)],dy=data[Math.min(h-1,y+1)*w+x]-data[Math.max(0,y-1)*w+x];
  normal[i]=Math.max(0,Math.min(255,Math.round(128-dx*.22)));normal[i+1]=Math.max(0,Math.min(255,Math.round(128-dy*.22)));normal[i+2]=255;
  rough[i]=255;rough[i+1]=Math.max(65,Math.min(90,Math.round(78+(v-160)*.15)));rough[i+2]=230;
  const c=Math.max(0,Math.min(255,Math.round(184+(v-160)*.32)));albedo[i]=c;albedo[i+1]=Math.min(255,c+3);albedo[i+2]=Math.min(255,c+6);
 }
 async function texture(name,buf){return doc.createTexture(name).setMimeType('image/png').setImage(new Uint8Array(await sharp(buf,{raw:{width:w,height:h,channels:3}}).png().toBuffer()));}
 const n=await texture('imagegen satin aluminum normal',normal),r=await texture('imagegen satin aluminum roughness metalness',rough),a=await texture('imagegen satin aluminum color',albedo);
 const find=name=>root.listMaterials().find(m=>m.getName()==='Silver Circuit | '+name);
 const rail=find('brushed silver rail');rail.setBaseColorTexture(a).setNormalTexture(n).setNormalScale(.45).setMetallicRoughnessTexture(r);
 // Keep the existing stand tint and artwork; only replace its striped response.
 const stand=find('silver stand');stand.setNormalTexture(n).setNormalScale(.35).setMetallicRoughnessTexture(null);
 for(const [name,prefix] of [['stand end panel','foot'],['navy underbody','under']]){
  const mat=find(name), tex=root.listTextures().find(t=>t.getName()===prefix+'_normal'),orm=root.listTextures().find(t=>t.getName()===prefix+'_metallic-'+prefix+'_roughness');
  if(!tex||!orm)throw Error('Missing original '+name+' maps');mat.setNormalTexture(tex).setNormalScale(.55).setMetallicRoughnessTexture(orm);
 }
 await io.write(file,doc);console.log('Applied image-generated aluminum and restored stand artwork maps.');
})().catch(e=>{console.error(e);process.exitCode=1});
