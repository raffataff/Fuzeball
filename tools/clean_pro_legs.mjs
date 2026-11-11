import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), f='assets/tables/classic/fuzeball_table_classic_proLeague.glb',d=await io.read(f),root=d.getRoot();
const used=new Set(root.listMeshes().flatMap(m=>m.listPrimitives().map(p=>p.getMaterial())));
for(const m of root.listMaterials())if(m.getName().startsWith('Pro League |')&&!used.has(m))m.dispose();
for(const t of root.listTextures())if(t.getName().startsWith('leg_')&&t.listParents().length===1)t.dispose();
await io.write(f,d);console.log('Unused previous leg materials removed.');
