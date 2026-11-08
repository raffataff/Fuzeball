// A skin may hide the cosmetic net; switching skins or falling back must restore it.
// Run from the project root: node tools/skin-net-harness.js
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
function extract(file,name){const src=fs.readFileSync(file,'utf8'),start=src.indexOf('function '+name+'(');
 if(start<0)throw Error(name+' not found');let depth=0;
 for(let i=src.indexOf('{',start);i<src.length;i++){
  if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
 }throw Error(name+' unbalanced');}
const vec=()=>({set(){return this;},setRGB(){return this;},copy(){return this;},multiplyScalar(){return this;}});
const m={opacity:.85,emissive:vec(),userData:{rip:{uRip:{value:vec()},uRipA:{value:0},uRipC:{value:vec()}}}};
const nets=[{visible:true,material:m},{visible:true,material:m}],front={visible:true};
const groups={silver:{children:[{}]},standard:{children:[{}]}};
const c={CONFIG:{tables:{circuit:{skins:{silver:{hideGoalNet:true},standard:{}}}}},
 chosen:'silver',skinGroups:{circuit:groups},tablePrimObjs:{},skinLed:{},skinRodHoles:{},
 skinHasFrame:{circuit:{silver:true,standard:true}},rodHoleMeshes:[],
 goalFrames:[{userData:{front,net:nets}}],primLedMat:null,ledMat:null,
 netMats:[m],VFX:{sp:{},pools:[],lights:[],u:{uFade:{value:1}},cam:{},net:[{a:0,t:99,x:0,y:0,z:0,col:{r:1,g:.5,b:.2}}]},
 VF:{goal:{net:{ripple:1,pulse:2.4}}},fxLightPut(){}};
c.curSkin=()=>c.chosen;vm.createContext(c);
vm.runInContext(extract('js/arena.js','applySkin')+'\n'+extract('js/vfx.js','vfxNetUpdate')+'\n'+extract('js/vfx.js','vfxClear'),c);
c.applySkin('circuit');assert(nets.every(n=>!n.visible));assert(!front.visible);
c.VFX.net[0].a=1;c.VFX.net[0].t=0;c.vfxNetUpdate(.1);
assert(nets.every(n=>n.visible));assert(m.opacity>0&&m.opacity<.85);
c.vfxClear();assert(nets.every(n=>!n.visible));assert.equal(m.userData.rip.uRipA.value,0);
c.VFX.net[0].a=1;c.VFX.net[0].t=0;c.vfxNetUpdate(.1);c.vfxNetUpdate(3);assert(nets.every(n=>!n.visible));
c.chosen='standard';c.applySkin('circuit');assert(nets.every(n=>n.visible));assert(!front.visible);
assert.equal(m.opacity,.85,'switching skins restores net opacity');
groups.silver.children=[];c.chosen='silver';c.applySkin('circuit');
assert(nets.every(n=>n.visible));assert(front.visible);
console.log('Skin net harness: portal ripple appears and fades; other skins and fallback restore the net.');
