// behavioural harness for the GLB light + emissive transfer (js/models.js). Run: node tools/roomlight-harness.js
// no three.js or browser: the two functions are string-sliced from models.js and rebuilt with new Function, then run against the real numbers read from the room GLBs' JSON chunks
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/models.js'),'utf8');

function slice(name){
 const start=SRC.indexOf('function '+name+'(');
 if(start<0)throw new Error('not found: '+name);
 let d=0;
 for(let j=SRC.indexOf('{',start);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return SRC.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
const SRC_LIGHTS=slice('applyRoomLights'), SRC_EMIS=slice('applyEmissiveStrength');

function V3(){this.x=0;this.y=0;this.z=0;}
V3.prototype.length=function(){return Math.hypot(this.x,this.y,this.z);};
const THREE={Vector3:V3};

function mkLight(o){
 return {name:o.name,isLight:true,
  isPointLight:o.type==='point',isSpotLight:o.type==='spot',isDirectionalLight:o.type==='dir',
  intensity:o.intensity,distance:0,decay:1,castShadow:true,_p:o.pos,userData:{},
  getWorldPosition(v){v.x=o.pos[0];v.y=o.pos[1];v.z=o.pos[2];return v;}};
}
function mkRoom(lights){
 return {updateMatrixWorld(){},traverse(f){f(this);lights.forEach(f);}};
}
function build(CONFIG){
 const f=new Function('CONFIG','THREE','console',
  SRC_LIGHTS+'\n'+SRC_EMIS+'\nreturn {applyRoomLights,applyEmissiveStrength};');
 return f(CONFIG,THREE,{log(){}});
}
const CFG=(over)=>({render:{roomLight:Object.assign({gain:1,reach:3,decay:2,minDist:20,max:0},over||{})}});

// three's physical falloff (getDistanceAttenuation without LEGACY_LIGHTS): d^-decay, windowed to distance
function falloff(d,distance,decay){
 let f=1/Math.max(Math.pow(d,decay),0.01);
 if(distance>0)f*=Math.pow(Math.max(0,Math.min(1,1-Math.pow(d/distance,4))),2);
 return f;
}
const dist=p=>Math.hypot(p[0],p[1],p[2]);
const deliver=l=>l.intensity*falloff(dist(l._p),l.distance,l.decay);

const SAUCER=()=>[
 mkLight({name:'Saucer_Ambient_Fill',type:'point',intensity:8152.711959882338,pos:[0,114.0250015258789,-27.21666145324707]}),
 mkLight({name:'Table_Spotlight',type:'spot',intensity:46198.70110599992,pos:[0,207.62501525878906,-27.21666145324707]})];
const PUB=()=>[
 mkLight({name:'room_light_fire',type:'point',intensity:1739.2452181082324,pos:[-388.45355224609375,-26.899202346801758,105.18301391601562]}),
 mkLight({name:'room_light_pendant',type:'spot',intensity:1087.0282613176453,pos:[-0.2584349513053894,97.08324432373047,1.8643112182617188]}),
 mkLight({name:'room_light_sconce_1',type:'point',intensity:1195.7310874494096,pos:[-252.76934814453125,73.46753692626953,-53.632591247558594]})];

let pass=0,fail=0;const fails=[];
function ok(c,msg,extra){if(c)pass++;else{fail++;fails.push(msg+(extra?'  ['+extra+']':''));}}
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?1e-6:t);
const SAUCER_RATIO=(46198.70110599992/Math.pow(dist(SAUCER()[1]._p),2))/(8152.711959882338/Math.pow(dist(SAUCER()[0]._p),2));

/* === 1. candela in, inverse-square out ==================================== */
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:3.2,reach:0}});
 ok(near(SAUCER_RATIO,1.7752,1e-3),'authored irradiance ratio at the table is ~1.78:1',SAUCER_RATIO.toFixed(4));
 ok(near(deliver(L[1])/deliver(L[0]),SAUCER_RATIO,1e-6),'delivered ratio == authored inverse-square ratio',(deliver(L[1])/deliver(L[0])).toFixed(4));
 ok(near(L[1].intensity,46198.70110599992*3.2,1e-6),'intensity is candela x gain');
 ok(L.every(l=>l.decay===2),'decay is the config\'s (2: inverse-square)');
}

/* === 2. the cutoff: scale invariant, linear knob ========================== */
{
 const one=h=>{const A=build(CFG());const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,h,0]});
  A.applyRoomLights(mkRoom([l]),{});return l;};
 const lo=one(90),hi=one(210);
 ok(near(lo.distance,270)&&near(hi.distance,630),'cutoff = d0 x reach');
 const w=l=>falloff(dist(l._p),l.distance,l.decay)*Math.pow(dist(l._p),2);
 ok(near(w(lo),w(hi),1e-9),'a 90-unit and a 210-unit fixture lose the SAME share to the window at the table');
 ok(near(w(lo),Math.pow(1-Math.pow(1/3,4),2),1e-9),'that share is (1-reach^-4)^2');
 const atGain=g=>{const A=build(CFG());const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,120,0]});
  A.applyRoomLights(mkRoom([l]),{light:{gain:g}});return deliver(l);};
 ok(near(atGain(4)/atGain(1),4,1e-9),'delivered light is LINEAR in gain');
}

/* === 3. ratio-preserving ceiling ========================================== */
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:4}});
 ok(near(Math.max(L[0].intensity,L[1].intensity),4,1e-9),'CEILING: brightest light pulled to max');
 ok(near(L[1].intensity/L[0].intensity,46198.70110599992/8152.711959882338,1e-6),'CEILING: ratio SURVIVES normalisation');
}
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:0}});
 ok(Math.max(L[0].intensity,L[1].intensity)>4,'CEILING: max:0 disables it entirely');
}

/* === 4. guards ============================================================ */
{
 const A=build(CFG());
 const l=mkLight({name:'origin',type:'point',intensity:1000,pos:[0,0,0]});
 A.applyRoomLights(mkRoom([l]),{});
 ok(isFinite(l.intensity)&&l.intensity>0,'GUARD: a fixture AT the origin keeps a finite intensity',l.intensity);
 ok(near(l.distance,60,1e-9),'GUARD: minDist floors the cutoff (20 x reach)',l.distance);
}
{
 const A=build(CFG());
 const l=mkLight({name:'flat',type:'point',intensity:1000,pos:[0,120,0]});
 A.applyRoomLights(mkRoom([l]),{light:{reach:0}});
 ok(l.distance===0,'GUARD: reach:0 -> no cutoff');
}
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{});
 ok(L.every(l=>l.castShadow===false),'GUARD: no room light casts shadows');
}
{
 const A=build(CFG());
 const d=mkLight({name:'sun',type:'dir',intensity:2,pos:[0,300,0]});
 A.applyRoomLights(mkRoom([d]),{light:{gain:3}});
 ok(near(d.intensity,6,1e-9),'GUARD: directional in a room glb takes gain',d.intensity);
 ok(d.distance===0&&d.decay===1,'GUARD: a directional gets no cutoff or decay');
}
{
 const A=build(CFG());
 ok(A.applyRoomLights(mkRoom([]),{}).length===0,'GUARD: a room with no lights returns empty, no throw');
}
{
 const A=build(CFG());
 const L=PUB();A.applyRoomLights(mkRoom(L),{light:{gain:2},lightsOff:['ROOM_LIGHT_FIRE']});
 ok(L[0].intensity===0&&near(L[0].userData.roomOffInt,1739.2452181082324*2,1e-6),'OFF: a named fixture is 0, its value kept');
 A.applyRoomLights(mkRoom(L),{light:{gain:2}});
 ok(near(L[1].intensity,1087.0282613176453*2,1e-6),'IDEMPOTENT: a second transfer starts from the stashed candela');
}

/* === 5. emissive strength ================================================= */
{
 const A=build(CFG());
 const m=(s,ei)=>({emissive:{r:1},emissiveIntensity:ei,needsUpdate:false,
   userData:s===undefined?{}:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:s}}}});
 const a=m(4,1),b=m(1,1),c=m(undefined,1),d=m(2,0.5),shared=m(3,1);
 A.applyEmissiveStrength({traverse(f){[{material:a},{material:b},{material:c},{material:d},
   {material:shared},{material:shared},{material:[a]}].forEach(f);}});
 ok(near(a.emissiveIntensity,4),'EMIS: strength 4 -> emissiveIntensity 4',a.emissiveIntensity);
 ok(a.needsUpdate===true,'EMIS: material flagged for recompile');
 ok(near(b.emissiveIntensity,1),'EMIS: strength 1 is a no-op');
 ok(b.needsUpdate===false,'EMIS: strength 1 does not touch needsUpdate');
 ok(near(c.emissiveIntensity,1),'EMIS: no extension -> untouched');
 ok(near(d.emissiveIntensity,1.0),'EMIS: multiplies an authored emissiveIntensity (0.5*2)',d.emissiveIntensity);
 ok(near(shared.emissiveIntensity,3),'EMIS: a SHARED material is applied ONCE, not per-mesh',shared.emissiveIntensity);
}
{
 const A=build({render:{emissiveStrength:false,roomLight:{}}});
 const m={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:4}}}};
 A.applyEmissiveStrength({traverse(f){f({material:m});}});
 ok(near(m.emissiveIntensity,1),'EMIS: render.emissiveStrength:false is a true off switch');
 const A2=build(CFG());
 [NaN,-1,'4',null,undefined].forEach(v=>{
  const x={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:v}}}};
  A2.applyEmissiveStrength({traverse(f){f({material:x});}});
  ok(near(x.emissiveIntensity,1),'EMIS: junk strength ignored ('+String(v)+')');});
 const noEmis={emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:4}}}};
 A2.applyEmissiveStrength({traverse(f){f({material:noEmis});}});
 ok(near(noEmis.emissiveIntensity,1),'EMIS: material with no emissive channel is skipped');
 A2.applyEmissiveStrength(null);ok(true,'EMIS: null root does not throw');
 A2.applyEmissiveStrength({traverse(f){f({});}});ok(true,'EMIS: object with no material does not throw');
}

/* === 6. the pub, end to end =============================================== */
{
 const A=build(CFG());
 const L=PUB();A.applyRoomLights(mkRoom(L),{light:{gain:5.45,reach:3.2}});
 const fire=deliver(L[0]),pend=deliver(L[1]),sc=deliver(L[2]);
 ok(fire>0&&sc>0,'PUB: fireplace and sconces deliver light','fire '+fire.toFixed(3)+' sconce '+sc.toFixed(3));
 ok(pend>fire&&pend>sc,'PUB: the pendant over the table is the key','pend '+pend.toFixed(3));
 ok(pend/sc>4,'PUB: pendant dominates the sconces as authored',(pend/sc).toFixed(2));
}

/* === 7. delivered-value report ============================================ */
function report(name,lights,light){
 const A=build(CFG());A.applyRoomLights(mkRoom(lights),{light});
 console.log('\n'+name+'  (gain '+light.gain+')');
 lights.forEach(l=>console.log('   '+String(l.name).padEnd(22)+
  ' d0='+String(Math.round(dist(l._p))).padStart(4)+
  '  intensity='+l.intensity.toFixed(1).padStart(10)+
  '  cutoff='+String(Math.round(l.distance)).padStart(5)+
  '  -> at table '+deliver(l).toFixed(3)));
}
console.log('\n=== delivered at the table (three.js physical units) ===');
report('saucer',SAUCER(),{gain:1.15});
report('pub',PUB(),{gain:5.45,reach:3.2});

// === 8. TEETH: each mutation below must BREAK something ===
function buildFrom(srcL,srcE,CONFIG){
 return new Function('CONFIG','THREE','console',
  srcL+'\n'+srcE+'\nreturn {applyRoomLights,applyEmissiveStrength};')(CONFIG,THREE,{log(){}});
}
function mutate(label,srcL,srcE,probe){
 if(srcL===SRC_LIGHTS&&srcE===SRC_EMIS)throw new Error('mutation is a no-op (anchor drifted): '+label);
 let broke=false,note='';
 try{broke=probe(buildFrom(srcL,srcE,CFG()));}
 catch(e){broke=true;note=' (threw: '+e.message.slice(0,40)+')';}
 ok(broke,'TEETH: '+label+' must fail an assertion'+note);
}
const INT_LINE='  l.intensity=cd*C.gain;';
mutate('per-light clamp',
 SRC_LIGHTS.replace(INT_LINE,INT_LINE+'l.intensity=Math.min(l.intensity,4);'),SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400}});
     return Math.abs(L[1].intensity/L[0].intensity-1)<0.05;});
mutate('the r128 1/d0^2 term back in',
 SRC_LIGHTS.replace(INT_LINE,'  l.intensity=cd/(d0*d0)*C.gain;'),SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:1,reach:0}});
     return Math.abs(deliver(L[1])/deliver(L[0])-SAUCER_RATIO)>0.01;});
mutate('a FIXED cutoff instead of d0*reach',
 SRC_LIGHTS.replace('l.distance=C.reach>0?d0*C.reach:0;','l.distance=l.isSpotLight?260:180;'),SRC_EMIS,
 A=>{const mk=h=>{const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,h,0]});
      A.applyRoomLights(mkRoom([l]),{});return falloff(h,l.distance,l.decay)*h*h;};
     return Math.abs(mk(90)-mk(210))>1e-6;});
mutate('dropping the minDist floor',
 SRC_LIGHTS.replace('const d0=Math.max(p.length(),C.minDist);','const d0=p.length();'),SRC_EMIS,
 A=>{const l=mkLight({name:'o',type:'point',intensity:1000,pos:[0,0,0]});
     A.applyRoomLights(mkRoom([l]),{});return l.distance!==60;});
mutate('dropping the shared-material guard',
 SRC_LIGHTS,SRC_EMIS.replace('if(!m||seen.has(m))return;seen.add(m);','if(!m)return;'),
 A=>{const sh={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:3}}}};
     A.applyEmissiveStrength({traverse(f){[{material:sh},{material:sh}].forEach(f);}});
     return Math.abs(sh.emissiveIntensity-3)>1e-9;});
mutate('normalising each light to max independently',
 SRC_LIGHTS.replace('if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity*=k);',
                    'if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity=Math.min(l.intensity,C.max));'),
 SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:4}});
     return Math.abs(L[1].intensity/L[0].intensity-1)<0.05;});
mutate('no candela stash (re-transfer compounds the gain)',
 SRC_LIGHTS.replace('if(l.userData.rlCandela===undefined){','if(true){'),SRC_EMIS,
 A=>{const L=PUB();A.applyRoomLights(mkRoom(L),{light:{gain:2}});A.applyRoomLights(mkRoom(L),{light:{gain:2}});
     return !near(L[1].intensity,1087.0282613176453*2,1e-6);});

console.log('\nroomlight harness: '+pass+' passed, '+fail+' failed');
if(fail){console.log('\nFAILURES:');fails.forEach(f=>console.log('  x '+f));process.exit(1);}
console.log('all assertions passed (incl. 7 mutation checks)');
