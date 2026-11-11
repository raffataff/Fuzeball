import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {mergeDocuments,unpartition} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),file='assets/tables/classic/fuzeball_table_classic_strike.glb';
const target=await io.read(file),source=await io.read('output/strike-new-legs.glb');
const scene=target.getRoot().getDefaultScene(),old=target.getRoot().listNodes().filter(n=>n.getName().startsWith('table_leg'));
if(old.length!==4)throw Error('Expected four Strike legs');
for(const n of old){const mesh=n.getMesh();n.dispose();if(mesh)mesh.dispose();}
const sourceScene=source.getRoot().getDefaultScene(),map=mergeDocuments(target,source),copied=map.get(sourceScene);
for(const node of copied.listChildren())scene.addChild(node);copied.dispose();await target.transform(unpartition());await io.write(file,target);
console.log('Installed textured Strike legs.');
