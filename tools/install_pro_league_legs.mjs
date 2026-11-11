import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {mergeDocuments, unpartition} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const file='assets/tables/classic/fuzeball_table_classic_proLeague.glb';
const target=await io.read(file), source=await io.read('output/pro-league-new-legs.glb');
const scene=target.getRoot().getDefaultScene();
const old=target.getRoot().listNodes().filter(n=>/^(table_leg|pro_leg_|pro_inner_rail)/.test(n.getName()));
if(!old.some(n=>n.getName().startsWith('table_leg')))throw new Error('Missing leg assembly');
for(const node of old){const mesh=node.getMesh();node.dispose();if(mesh)mesh.dispose();}
const sourceScene=source.getRoot().getDefaultScene();const map=mergeDocuments(target,source);
const copiedScene=map.get(sourceScene);for(const node of copiedScene.listChildren())scene.addChild(node);copiedScene.dispose();
await target.transform(unpartition()); await io.write(file,target);console.log('Replaced old braced assembly with',sourceScene.listChildren().length,'parts');

