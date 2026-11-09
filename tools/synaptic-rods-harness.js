'use strict';
const fs=require('fs'),assert=require('assert'),sharp=require('sharp');
global.THREE=require('../vendor/three.min.js');global.self=global;require('../vendor/GLTFLoader.js');
THREE.TextureLoader.prototype.load=function(_url,done){const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
(async()=>{for(const n of [1,2,3,5]){
 const file=`assets/rods/synaptic_relic/fuzeball_rod_${n}man.glb`,b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len).toString().trim()),bin=20+len+8;
 for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];const meta=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();assert(meta.width&&meta.height);}
 const scene=await new Promise((ok,fail)=>new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',g=>ok(g.scene),fail));
 let grip,knob;scene.traverse(o=>{if(o.isMesh&&o.name.toLowerCase().includes('handle_relic'))grip=o;if(o.isMesh&&o.name.toLowerCase().includes('knob')&&/^team/i.test(o.material.name))knob=o;});
 assert(grip&&grip.material.map&&grip.material.normalMap&&grip.material.roughnessMap&&grip.material.metalnessMap&&grip.material.emissiveMap,'grip PBR maps');
 assert(knob&&/^team/i.test(knob.material.name),'team-coloured knob preserved');
 }console.log('Synaptic Relic rods: four GLBs parsed, all embedded maps decoded, PBR grip and team knobs present.');})().catch(e=>{console.error(e);process.exitCode=1;});
