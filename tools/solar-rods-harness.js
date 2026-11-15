'use strict';
const fs=require('fs'),assert=require('assert'),sharp=require('sharp');
global.self=global.window=global;require('../vendor/three.bundle.js');
THREE.TextureLoader.prototype.load=function(_url,done){const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
(async()=>{for(const n of [1,2,3,5]){
 const file=`assets/rods/solar_forge/fuzeball_rod_${n}man.glb`,b=fs.readFileSync(file),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len).toString().trim()),bin=20+len+8;
 for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];const meta=await sharp(b.subarray(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength)).metadata();assert(meta.width&&meta.height);}
 const scene=await new Promise((ok,fail)=>new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',g=>ok(g.scene),fail));
 let grip,knob;scene.traverse(o=>{if(o.isMesh&&o.name.toLowerCase().includes('handle_solar'))grip=o;if(o.isMesh&&o.name.toLowerCase().includes('knob')&&/^team/i.test(o.material.name))knob=o;});
 assert(grip&&grip.material.map&&grip.material.normalMap&&grip.material.emissiveMap,'grip PBR maps');
 const {position,uv,normal,tangent}=grip.geometry.attributes;
 assert(tangent,'the wrapped normal map has a tangent basis');
 grip.geometry.computeBoundingBox();
 const {min,max}=grip.geometry.boundingBox;
 for(let i=0;i<position.count;i++){
  const u=(max.z-position.getZ(i))/(max.z-min.z);
  assert(Math.abs(uv.getX(i)-u)<1e-5,'decal U follows the shaft');
  const x=position.getX(i),y=position.getY(i),radius=Math.hypot(x,y);
  const nx=normal.getX(i),ny=normal.getY(i);
  assert((x*nx+y*ny)/(radius*Math.hypot(nx,ny))>.999,'smooth normals follow the grip curvature');
 }
 assert(knob&&/^team/i.test(knob.material.name),'team-coloured knob preserved');
 }console.log('Solar Forge rods: four GLBs parsed, all embedded maps decoded, PBR grip and team knobs present.');})().catch(e=>{console.error(e);process.exitCode=1;});
